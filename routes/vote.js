import express from 'express';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';
import VoteToken from '../models/VoteToken.js';

const router = express.Router();

// Récupérer le jeton de vote pour une élection
router.get('/token/:electionId', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { electionId } = req.params;

        const election = await prisma.election.findUnique({
            where: { id: parseInt(electionId) }
        });

        if (!election || !election.isActive) {
            return res.status(400).json({ message: "Cette élection n'est pas active" });
        }

        // Récupérer les informations complètes de l'étudiant
        const userWithStudent = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                etudiant: true
            }
        });

        if (!userWithStudent || !userWithStudent.etudiant) {
            return res.status(403).json({ message: 'Accès refusé - profil étudiant incomplet' });
        }

        const etudiant = userWithStudent.etudiant;

        if (!isEligibleForElection(etudiant, election)) {
            return res.status(403).json({
                message: 'Vous n\'êtes pas éligible pour cette élection'
            });
        }

        let voteToken = await prisma.voteToken.findFirst({
            where: {
                userId,
                electionId: parseInt(electionId),
                isUsed: false,
                expiresAt: { gt: new Date() }
            }
        });

        if (!voteToken) {
            voteToken = await VoteToken.createToken(userId, parseInt(electionId));
        }

        res.json({
            token: voteToken.token,
            expiresAt: voteToken.expiresAt,
            election: {
                id: election.id,
                titre: election.titre,
                type: election.type
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Soumettre un vote avec calcul du poids
router.post('/', async (req, res) => {
    try {
        const { electionId, candidateId, voteToken } = req.body;

        if (!electionId || !candidateId || !voteToken) {
            return res.status(400).json({
                message: 'ElectionId, CandidateId et VoteToken requis'
            });
        }

        const validatedToken = await VoteToken.validateToken(voteToken, parseInt(electionId));
        if (!validatedToken) {
            return res.status(400).json({ message: 'Jeton de vote invalide ou expiré' });
        }

        const userId = validatedToken.userId;

        const election = await prisma.election.findUnique({
            where: { id: parseInt(electionId) }
        });

        if (!election || !election.isActive) {
            return res.status(400).json({ message: "Cette élection n'est pas active" });
        }

        const existingVote = await prisma.vote.findUnique({
            where: {
                userId_electionId: {
                    userId,
                    electionId: parseInt(electionId),
                },
            },
        });

        if (existingVote) {
            return res.status(400).json({ message: 'Vous avez déjà voté pour cette élection' });
        }

        const candidate = await prisma.candidate.findUnique({
            where: { id: parseInt(candidateId) }
        });

        if (!candidate || candidate.electionId !== parseInt(electionId)) {
            return res.status(400).json({ message: 'Candidat invalide pour cette élection' });
        }

        // Calculer le poids du vote (1 pour étudiant normal, 1.6 pour responsable de salle)
        const poidsVote = await calculateVoteWeight(userId, election);

        // Enregistrement du vote avec poids
        await prisma.vote.create({
            data: {
                userId,
                electionId: parseInt(electionId),
                candidateId: parseInt(candidateId),
                poidsVote
            },
        });

        await VoteToken.markTokenAsUsed(voteToken);

        res.json({ message: 'Vote enregistré avec succès' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Calculer le poids du vote
async function calculateVoteWeight(userId, election) {
    try {
        // Vérifier si l'utilisateur est un responsable de salle
        const userWithStudent = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                etudiant: {
                    include: {
                        responsableSalle: {
                            where: {
                                filiere: election.filiere || undefined,
                                annee: election.annee || undefined,
                                ecole: election.ecole || undefined
                            }
                        }
                    }
                }
            }
        });

        // Si c'est un responsable de salle dans la même filière/année/école, poids = 1.6
        if (userWithStudent && userWithStudent.etudiant &&
            userWithStudent.etudiant.responsableSalle.length > 0) {
            return 1.6;
        }

        // Sinon, poids normal = 1
        return 1.0;
    } catch (error) {
        console.error('Erreur calcul poids vote:', error);
        return 1.0; // Par défaut en cas d'erreur
    }
}

// Récupérer les résultats d'une élection 
router.get('/results/:electionId', async (req, res) => {
    try {
        const { electionId } = req.params;

        const election = await prisma.election.findUnique({
            where: { id: parseInt(electionId) },
            include: {
                candidates: {
                    include: {
                        user: {
                            include: {
                                etudiant: true
                            }
                        }
                    }
                },
                votes: {
                    include: {
                        user: {
                            include: {
                                etudiant: {
                                    include: {
                                        responsableSalle: true
                                    }
                                }
                            }
                        }
                    }
                },
                _count: {
                    select: { voteTokens: true }
                }
            }
        });

        if (!election) {
            return res.status(404).json({ message: 'Élection non trouvée' });
        }

        // Calcul des résultats avec pondération
        const resultats = election.candidates.map(candidate => {
            const votes = election.votes.filter(vote => vote.candidateId === candidate.id);

            // Calcul du score pondéré
            let scorePondere = 0;
            votes.forEach(vote => {
                scorePondere += vote.poidsVote || 1.0; // Par défaut 1.0 si poids non défini
            });

            // Pourcentage basé sur le total des poids de votes
            const totalPoids = election.votes.reduce((sum, vote) => sum + (vote.poidsVote || 1.0), 0);
            const pourcentage = totalPoids > 0 ? (scorePondere / totalPoids) * 100 : 0;

            return {
                candidateId: candidate.id,
                nom: candidate.nom,
                prenom: candidate.prenom,
                scoreFinal: parseFloat(pourcentage.toFixed(2)),
                details: {
                    totalVotes: votes.length,
                    scorePondere: parseFloat(scorePondere.toFixed(2)),
                    poidsMoyen: votes.length > 0 ? parseFloat((scorePondere / votes.length).toFixed(2)) : 0
                }
            };
        });

        // TRI PAR SCORE FINAL
        resultats.sort((a, b) => b.scoreFinal - a.scoreFinal);

        const response = {
            election: {
                id: election.id,
                titre: election.titre,
                type: election.type,
                ecole: election.ecole,
                filiere: election.filiere,
                annee: election.annee,
                dateDebut: election.dateDebut,
                dateFin: election.dateFin,
                isActive: election.isActive
            },
            statistiques: {
                totalVotes: election.votes.length,
                totalPoids: election.votes.reduce((sum, vote) => sum + (vote.poidsVote || 1.0), 0),
                totalInscrits: election._count.voteTokens,
                tauxParticipation: election._count.voteTokens > 0
                    ? parseFloat(((election.votes.length / election._count.voteTokens) * 100).toFixed(2))
                    : 0
            },
            resultats: resultats
        };

        res.json(response);
    } catch (error) {
        console.error('Erreur calcul résultats:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Récupérer les résultats détaillés avec séparation responsables/étudiants
router.get('/results-detailed/:electionId', async (req, res) => {
    try {
        const { electionId } = req.params;

        const election = await prisma.election.findUnique({
            where: { id: parseInt(electionId) },
            include: {
                candidates: {
                    include: {
                        user: {
                            include: {
                                etudiant: true
                            }
                        }
                    }
                },
                votes: {
                    include: {
                        user: {
                            include: {
                                etudiant: {
                                    include: {
                                        responsableSalle: {
                                            where: {
                                                filiere: election.filiere || undefined,
                                                annee: election.annee || undefined,
                                                ecole: election.ecole || undefined
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                _count: {
                    select: { voteTokens: true }
                }
            }
        });

        if (!election) {
            return res.status(404).json({ message: 'Élection non trouvée' });
        }

        // SÉPARATION DES VOTES
        const votesResponsables = election.votes.filter(vote =>
            vote.user.etudiant?.responsableSalle &&
            vote.user.etudiant.responsableSalle.length > 0
        );

        const votesEtudiants = election.votes.filter(vote =>
            !vote.user.etudiant?.responsableSalle ||
            vote.user.etudiant.responsableSalle.length === 0
        );

        // CALCUL DES RÉSULTATS BRUTS
        const calculerVotes = (votes) => {
            const resultats = {};
            election.candidates.forEach(candidate => {
                resultats[candidate.id] = 0;
            });
            votes.forEach(vote => {
                resultats[vote.candidateId] = (resultats[vote.candidateId] || 0) + (vote.poidsVote || 1.0);
            });
            return resultats;
        };

        const votesParCandidatResponsables = calculerVotes(votesResponsables);
        const votesParCandidatEtudiants = calculerVotes(votesEtudiants);

        const totalVotesResponsables = votesResponsables.reduce((sum, vote) => sum + (vote.poidsVote || 1.0), 0);
        const totalVotesEtudiants = votesEtudiants.reduce((sum, vote) => sum + (vote.poidsVote || 1.0), 0);

        // CALCUL DES RÉSULTATS PONDÉRÉS (60/40)
        const resultatsPonderes = election.candidates.map(candidate => {
            const votesRespo = votesParCandidatResponsables[candidate.id] || 0;
            const votesEtud = votesParCandidatEtudiants[candidate.id] || 0;

            const pourcentageRespo = totalVotesResponsables > 0
                ? (votesRespo / totalVotesResponsables) * 100
                : 0;
            const pourcentageEtud = totalVotesEtudiants > 0
                ? (votesEtud / totalVotesEtudiants) * 100
                : 0;

            const scoreFinal = (pourcentageRespo * 0.6) + (pourcentageEtud * 0.4);

            return {
                candidateId: candidate.id,
                nom: candidate.nom,
                prenom: candidate.prenom,
                scoreFinal: parseFloat(scoreFinal.toFixed(2)),
                details: {
                    votesResponsables: votesRespo,
                    votesEtudiants: votesEtud,
                    totalVotes: votesRespo + votesEtud,
                    pourcentageResponsables: parseFloat(pourcentageRespo.toFixed(2)),
                    pourcentageEtudiants: parseFloat(pourcentageEtud.toFixed(2))
                }
            };
        });

        // TRI PAR SCORE FINAL
        resultatsPonderes.sort((a, b) => b.scoreFinal - a.scoreFinal);

        const response = {
            election: {
                id: election.id,
                titre: election.titre,
                type: election.type,
                ecole: election.ecole,
                filiere: election.filiere,
                annee: election.annee,
                dateDebut: election.dateDebut,
                dateFin: election.dateFin,
                isActive: election.isActive
            },
            statistiques: {
                totalVotes: election.votes.length,
                votesResponsables: votesResponsables.length,
                votesEtudiants: votesEtudiants.length,
                totalPoidsResponsables: totalVotesResponsables,
                totalPoidsEtudiants: totalVotesEtudiants,
                totalInscrits: election._count.voteTokens,
                tauxParticipation: election._count.voteTokens > 0
                    ? parseFloat(((election.votes.length / election._count.voteTokens) * 100).toFixed(2))
                    : 0
            },
            resultats: resultatsPonderes
        };

        res.json(response);
    } catch (error) {
        console.error('Erreur calcul résultats détaillés:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Vérifier le statut de vote d'un utilisateur
router.get('/status/:electionId', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { electionId } = req.params;

        const vote = await prisma.vote.findUnique({
            where: {
                userId_electionId: {
                    userId,
                    electionId: parseInt(electionId),
                },
            },
        });

        res.json({
            hasVoted: !!vote,
            electionId: parseInt(electionId)
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Backend: créer cet endpoint
router.get('/vote/my-votes', authenticateToken, async (req, res) => {
    try {
        const votes = await votes.find({ userId: req.user.id })
            .populate('electionId')
            .populate('candidateId');
        res.json(votes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Valider un token de vote 
router.post('/validate-token', authenticateToken, async (req, res) => {
    try {
        const { electionId, voteToken } = req.body;

        if (!electionId || !voteToken) {
            return res.status(400).json({
                message: 'ElectionId et voteToken requis'
            });
        }

        const validatedToken = await VoteToken.validateToken(voteToken, parseInt(electionId));

        if (!validatedToken) {
            return res.status(400).json({
                message: 'Jeton de vote invalide ou expiré',
                valid: false
            });
        }

        res.json({
            valid: true,
            expiresAt: validatedToken.expiresAt
        });
    } catch (error) {
        console.error('Erreur validation token:', error);
        res.status(500).json({ message: 'Erreur serveur', valid: false });
    }
});

export default router;