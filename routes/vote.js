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

        // Vérifier que l'élection existe et est active
        const election = await prisma.election.findUnique({
            where: { id: parseInt(electionId) },
            include: {
                _count: {
                    select: { voteTokens: true }
                }
            }
        });

        if (!election || !election.isActive) {
            return res.status(400).json({ message: "Cette élection n'est pas active" });
        }

        // Vérifier que l'étudiant est éligible pour cette élection
        const etudiant = await prisma.etudiant.findUnique({
            where: { userId },
            include: { user: true }
        });

        if (!etudiant) {
            return res.status(403).json({ message: 'Accès refusé' });
        }

        // Vérifier l'éligibilité selon le type d'élection
        if (!isEligibleForElection(etudiant, election)) {
            return res.status(403).json({
                message: 'Vous n\'êtes pas éligible pour cette élection'
            });
        }

        // Récupérer ou créer le jeton de vote
        let voteToken = await prisma.voteToken.findFirst({
            where: {
                userId,
                electionId: parseInt(electionId),
                isUsed: false,
                expiresAt: { gt: new Date() }
            }
        });

        if (!voteToken) {
            // Créer un nouveau jeton si nécessaire
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

// Voter avec un jeton
router.post('/', async (req, res) => {
    try {
        const { electionId, candidateId, voteToken } = req.body;

        if (!electionId || !candidateId || !voteToken) {
            return res.status(400).json({
                message: 'ElectionId, CandidateId et VoteToken requis'
            });
        }

        // Valider le jeton de vote
        const validatedToken = await VoteToken.validateToken(voteToken, parseInt(electionId));
        if (!validatedToken) {
            return res.status(400).json({
                message: 'Jeton de vote invalide ou expiré'
            });
        }

        const userId = validatedToken.userId;

        // Vérifier que l'élection est active
        const election = await prisma.election.findUnique({
            where: { id: parseInt(electionId) }
        });

        if (!election || !election.isActive) {
            return res.status(400).json({
                message: "Cette élection n'est pas active"
            });
        }

        // Vérifier que l'utilisateur n'a pas déjà voté pour cette élection
        const existingVote = await prisma.vote.findUnique({
            where: {
                userId_electionId: {
                    userId,
                    electionId: parseInt(electionId),
                },
            },
        });

        if (existingVote) {
            return res.status(400).json({
                message: 'Vous avez déjà voté pour cette élection'
            });
        }

        // Vérifier que le candidat appartient bien à l'élection
        const candidate = await prisma.candidate.findUnique({
            where: { id: parseInt(candidateId) }
        });

        if (!candidate || candidate.electionId !== parseInt(electionId)) {
            return res.status(400).json({
                message: 'Candidat invalide pour cette élection'
            });
        }

        // Enregistrer le vote
        await prisma.vote.create({
            data: {
                userId,
                electionId: parseInt(electionId),
                candidateId: parseInt(candidateId),
            },
        });

        // Marquer le jeton comme utilisé
        await VoteToken.markTokenAsUsed(voteToken);

        res.json({ message: 'Vote enregistré avec succès' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Récupérer les résultats d'une élection (après clôture)
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
                _count: {
                    select: {
                        votes: true,
                        voteTokens: true
                    }
                }
            }
        });

        if (!election) {
            return res.status(404).json({ message: 'Élection non trouvée' });
        }

        // Calculer les résultats
        const results = await prisma.vote.groupBy({
            by: ['candidateId'],
            where: { electionId: parseInt(electionId) },
            _count: { candidateId: true }
        });

        // Formater les résultats
        const formattedResults = election.candidates.map(candidate => {
            const voteCount = results.find(r => r.candidateId === candidate.id)?._count.candidateId || 0;
            const totalVotes = election._count.votes;
            const percentage = totalVotes > 0 ? (voteCount / totalVotes * 100).toFixed(2) : 0;

            return {
                id: candidate.id,
                nom: candidate.nom,
                prenom: candidate.prenom,
                filiere: candidate.user.etudiant.filiere,
                annee: candidate.user.etudiant.annee,
                votes: voteCount,
                percentage: `${percentage}%`
            };
        });

        // Trier par nombre de votes décroissant
        formattedResults.sort((a, b) => b.votes - a.votes);

        const electionResults = {
            election: {
                id: election.id,
                titre: election.titre,
                type: election.type,
                dateDebut: election.dateDebut,
                dateFin: election.dateFin,
                isActive: election.isActive
            },
            stats: {
                totalVotes: election._count.votes,
                totalTokens: election._count.voteTokens,
                participationRate: election._count.voteTokens > 0 ?
                    (election._count.votes / election._count.voteTokens * 100).toFixed(2) : 0
            },
            results: formattedResults
        };

        res.json(electionResults);
    } catch (error) {
        console.error(error);
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

        const hasVoted = !!vote;
        res.json({ hasVoted, electionId: parseInt(electionId) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

/**
 * Vérifie si un étudiant est éligible pour une élection donnée
 * @param {Object} etudiant - L'étudiant à vérifier
 * @param {Object} election - L'élection
 * @returns {boolean} True si éligible
 */
function isEligibleForElection(etudiant, election) {
    if (election.type === 'SALLE') {
        return etudiant.filiere === election.filiere && etudiant.annee === election.annee;
    } else if (election.type === 'ECOLE') {
        // Pour les élections d'école, vérifier si l'étudiant est responsable de salle
        // Cette logique peut être étendue selon vos besoins
        return etudiant.filiere.includes(election.ecole) ||
            etudiant.filiere === election.ecole;
    } else if (election.type === 'UNIVERSITE') {
        // Pour les élections universitaires, vérifier si l'étudiant est délégué d'école
        // Cette logique peut être étendue selon vos besoins
        return true; // Temporairement tous les étudiants sont éligibles
    }

    return false;
}

export default router;
