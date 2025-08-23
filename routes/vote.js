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

        const etudiant = await prisma.etudiant.findUnique({
            where: { userId },
            include: { user: true }
        });

        if (!etudiant) {
            return res.status(403).json({ message: 'Accès refusé' });
        }

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

// Soumettre un vote
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

        // ENREGISTREMENT DU VOTE (SANS POIDS)
        await prisma.vote.create({
            data: {
                userId,
                electionId: parseInt(electionId),
                candidateId: parseInt(candidateId),
            },
        });

        await VoteToken.markTokenAsUsed(voteToken);

        res.json({ message: 'Vote enregistré avec succès' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Récupérer les résultats d'une élection (AVEC PONDÉRATION 60/40)
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
                                        responsableSalle: {
                                            where: { ecole: election.ecole } // Filtrer par école de l'élection
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
                resultats[vote.candidateId] = (resultats[vote.candidateId] || 0) + 1;
            });
            return resultats;
        };

        const votesParCandidatResponsables = calculerVotes(votesResponsables);
        const votesParCandidatEtudiants = calculerVotes(votesEtudiants);

        const totalVotesResponsables = votesResponsables.length;
        const totalVotesEtudiants = votesEtudiants.length;

        // CALCUL DES RÉSULTATS PONDÉRÉS
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
                dateDebut: election.dateDebut,
                dateFin: election.dateFin,
                isActive: election.isActive
            },
            statistiques: {
                totalVotes: election.votes.length,
                votesResponsables: totalVotesResponsables,
                votesEtudiants: totalVotesEtudiants,
                totalInscrits: election._count.voteTokens,
                tauxParticipation: election._count.voteTokens > 0
                    ? parseFloat(((election.votes.length / election._count.voteTokens) * 100).toFixed(2))
                    : 0
            },
            resultats: resultatsPonderes
        };

        res.json(response);
    } catch (error) {
        console.error('Erreur calcul résultats:', error);
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

// FONCTION: Vérifier l'éligibilité
function isEligibleForElection(etudiant, election) {
    if (election.type === 'SALLE') {
        return etudiant.filiere === election.filiere && etudiant.annee === election.annee;
    } else if (election.type === 'ECOLE') {
        return etudiant.ecole === election.ecole;
    } else if (election.type === 'UNIVERSITE') {
        return true;
    }
    return false;
}

export default router;