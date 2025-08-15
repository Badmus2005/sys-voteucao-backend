import express from 'express';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = express.Router();

/**
 * GET /stats
 * Route générale pour les statistiques (redirige vers dashboard)
 */
router.get('/', authenticateToken, async (req, res) => {
    // Rediriger vers la route dashboard pour maintenir la compatibilité
    req.url = '/dashboard';
    return router.handle(req, res);
});

/**
 * GET /stats/dashboard
 * Récupère les statistiques pour le dashboard admin
 */
router.get('/dashboard', authenticateToken, async (req, res) => {
    try {
        const [totalUsers, totalVotes, todayVotes, totalCandidates] = await Promise.all([
            prisma.user.count(),
            prisma.vote.count(),
            prisma.vote.count({
                where: {
                    createdAt: {
                        gte: new Date(new Date().setHours(0, 0, 0, 0))
                    }
                }
            }),
            prisma.candidate.count()
        ]);

        // Calcul des pourcentages
        const userGrowth = await calculateGrowth('user');
        const voteGrowth = await calculateGrowth('vote');

        res.json({
            users: {
                total: totalUsers,
                percent: userGrowth
            },
            votes: {
                total: totalVotes,
                percent: voteGrowth,
                today: todayVotes
            },
            candidates: {
                total: totalCandidates
            }
        });
    } catch (err) {
        console.error("Erreur stats:", err);
        res.status(500).json({ message: "Erreur serveur" });
    }
});

/**
 * GET /stats/election/:id
 * Récupère les statistiques pour une élection spécifique
 */
router.get('/election/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        const election = await prisma.election.findUnique({
            where: { id: parseInt(id) },
            include: {
                _count: {
                    select: {
                        votes: true,
                        voteTokens: true,
                        candidates: true
                    }
                },
                candidates: {
                    include: {
                        user: {
                            include: {
                                etudiant: true
                            }
                        },
                        _count: {
                            select: { votes: true }
                        }
                    }
                }
            }
        });

        if (!election) {
            return res.status(404).json({ message: 'Élection non trouvée' });
        }

        // Calculer les statistiques détaillées
        const totalVotes = election._count.votes;
        const totalTokens = election._count.voteTokens;
        const participationRate = totalTokens > 0 ? (totalVotes / totalTokens * 100).toFixed(2) : 0;

        // Statistiques par candidat
        const candidateStats = election.candidates.map(candidate => ({
            id: candidate.id,
            nom: candidate.nom,
            prenom: candidate.prenom,
            filiere: candidate.user.etudiant.filiere,
            annee: candidate.user.etudiant.annee,
            votes: candidate._count.votes,
            percentage: totalVotes > 0 ? (candidate._count.votes / totalVotes * 100).toFixed(2) : 0
        }));

        // Trier par nombre de votes décroissant
        candidateStats.sort((a, b) => b.votes - a.votes);

        res.json({
            election: {
                id: election.id,
                titre: election.titre,
                type: election.type,
                dateDebut: election.dateDebut,
                dateFin: election.dateFin,
                isActive: election.isActive
            },
            stats: {
                totalVotes,
                totalTokens,
                participationRate: parseFloat(participationRate),
                totalCandidates: election._count.candidates
            },
            candidates: candidateStats
        });
    } catch (error) {
        console.error('Erreur stats élection:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Helper function
async function calculateGrowth(entity) {
    try {
        const now = new Date();
        const lastMonth = new Date(now.setMonth(now.getMonth() - 1));

        const currentCount = await prisma[entity].count();
        const previousCount = await prisma[entity].count({
            where: {
                createdAt: { lt: lastMonth }
            }
        });

        if (previousCount === 0) return 100;
        return Math.round(((currentCount - previousCount) / previousCount) * 100);
    } catch {
        return 0;
    }
}

export default router;