import express from 'express';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = express.Router();

/**
 * GET /stats/general
 * Récupère les statistiques générales pour le dashboard
 */
router.get('/general', authenticateToken, async (req, res) => {
    try {
        const { period = '30', electionId } = req.query;

        // Sécurisation des paramètres
        const parsedPeriod = parseInt(period);
        const startDate = isNaN(parsedPeriod) ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) : calculateStartDate(parsedPeriod);
        const electionIdInt = electionId ? parseInt(electionId) : undefined;

        // Requêtes Prisma sécurisées
        const [totalUsers, totalVotes, totalElections, totalCandidates] = await Promise.all([
            prisma.user.count({
                where: {
                    role: 'ETUDIANT',
                    createdAt: { gte: startDate }
                }
            }),
            prisma.vote.count({
                where: electionIdInt ? {
                    electionId: electionIdInt,
                    createdAt: { gte: startDate }
                } : {
                    createdAt: { gte: startDate }
                }
            }),
            prisma.election.count({
                where: {
                    createdAt: { gte: startDate }
                }
            }),
            prisma.candidate.count({
                where: {
                    createdAt: { gte: startDate }
                }
            })
        ]);

        // Calculs encapsulés avec fallback
        let participationData = {
            userPercent: 0,
            votePercent: 0,
            candidatePercent: 0,
            electionPercent: 0
        };
        let avgVoteTime = 0;

        try {
            participationData = await calculateParticipationRate(electionIdInt, startDate);
        } catch (err) {
            console.warn('Erreur participationRate:', err.message);
        }

        try {
            avgVoteTime = await calculateAverageVoteTime(electionIdInt, startDate);
        } catch (err) {
            console.warn('Erreur avgVoteTime:', err.message);
        }

        // Réponse structurée pour le frontend
        res.json({
            users: {
                total: totalUsers,
                percent: participationData.userPercent || 0
            },
            votes: {
                total: totalVotes,
                percent: participationData.votePercent || 0
            },
            candidates: {
                total: totalCandidates,
                percent: participationData.candidatePercent || 0
            },
            elections: {
                active: totalElections,
                percent: participationData.electionPercent || 0
            },
            avgVoteTime,
            lastUpdated: new Date().toISOString()
        });
    } catch (error) {
        console.error('Erreur stats générales:', error);
        res.status(500).json({
            message: 'Erreur serveur',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});



/**
 * GET /stats/votes
 * Récupère les données pour le graphique d'évolution des votes
 */
router.get('/votes', authenticateToken, async (req, res) => {
    try {
        const { period = '30', electionId } = req.query;
        const startDate = calculateStartDate(parseInt(period));

        // Récupérer les votes groupés par jour
        const votesByDay = await prisma.vote.groupBy({
            by: ['createdAt'],
            where: {
                ...(electionId && { electionId: parseInt(electionId) }),
                createdAt: { gte: startDate }
            },
            _count: { _all: true },
            orderBy: { createdAt: 'asc' }
        });

        // Formater les données pour Chart.js
        const labels = [];
        const values = [];

        // Générer les données pour chaque jour de la période
        const currentDate = new Date(startDate);
        const today = new Date();

        while (currentDate <= today) {
            const dateStr = currentDate.toISOString().split('T')[0];
            const votesForDay = votesByDay.find(v =>
                v.createdAt.toISOString().split('T')[0] === dateStr
            );

            labels.push(formatDate(currentDate));
            values.push(votesForDay ? votesForDay._count._all : 0);

            currentDate.setDate(currentDate.getDate() + 1);
        }

        res.json({ labels, values });
    } catch (error) {
        console.error('Erreur stats votes:', error);
        res.status(500).json({
            message: 'Erreur serveur',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * GET /stats/distribution
 * Récupère la répartition des votes par candidat
 */
router.get('/distribution', authenticateToken, async (req, res) => {
    try {
        const { electionId } = req.query;

        if (!electionId) {
            return res.status(400).json({ message: 'ID d\'élection requis' });
        }

        const votesDistribution = await prisma.candidate.findMany({
            where: { electionId: parseInt(electionId) },
            include: {
                _count: {
                    select: { votes: true }
                },
                user: {
                    include: {
                        etudiant: true
                    }
                }
            },
            orderBy: {
                votes: { _count: 'desc' }
            }
        });

        const labels = votesDistribution.map(c => `${c.user.etudiant.prenom} ${c.user.etudiant.nom}`);
        const values = votesDistribution.map(c => c._count.votes);

        res.json({ labels, values });
    } catch (error) {
        console.error('Erreur distribution votes:', error);
        res.status(500).json({
            message: 'Erreur serveur',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * GET /stats/hourly
 * Récupère la participation par heure
 */
router.get('/hourly', authenticateToken, async (req, res) => {
    try {
        const { period = '7', electionId } = req.query;
        const startDate = calculateStartDate(parseInt(period));

        // Récupérer les votes groupés par heure
        const votesByHour = await prisma.vote.groupBy({
            by: ['createdAt'],
            where: {
                ...(electionId && { electionId: parseInt(electionId) }),
                createdAt: { gte: startDate }
            },
            _count: { _all: true }
        });

        // Préparer les données pour les 24 heures
        const hourlyData = Array(24).fill(0);

        votesByHour.forEach(vote => {
            const hour = new Date(vote.createdAt).getHours();
            hourlyData[hour] += vote._count._all;
        });

        const labels = Array.from({ length: 24 }, (_, i) => `${i}h`);
        const values = hourlyData;

        res.json({ labels, values });
    } catch (error) {
        console.error('Erreur stats horaires:', error);
        res.status(500).json({
            message: 'Erreur serveur',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * GET /stats/comparison
 * Récupère les données de comparaison entre élections
 */
router.get('/comparison', authenticateToken, async (req, res) => {
    try {
        const { period = '365' } = req.query;
        const startDate = calculateStartDate(parseInt(period));

        const elections = await prisma.election.findMany({
            where: {
                createdAt: { gte: startDate }
            },
            include: {
                _count: {
                    select: {
                        votes: true,
                        voteTokens: true
                    }
                }
            },
            orderBy: { dateDebut: 'asc' }
        });

        const labels = elections.map(e => e.titre);
        const registered = elections.map(e => e._count.voteTokens);
        const voters = elections.map(e => e._count.votes);

        res.json({ labels, registered, voters });
    } catch (error) {
        console.error('Erreur comparaison élections:', error);
        res.status(500).json({
            message: 'Erreur serveur',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * GET /stats/export
 * Export des statistiques
 */
router.get('/export', authenticateToken, async (req, res) => {
    try {
        const { format = 'pdf', period = '30', electionId } = req.query;

        // Ici vous implémenteriez la logique d'export réelle
        // Pour l'exemple, nous retournons un JSON
        const statsData = await generateExportData(period, electionId);

        if (format === 'json') {
            res.json(statsData);
        } else {
            // Pour PDF/Excel, vous utiliseriez des bibliothèques comme pdfkit ou exceljs
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename=statistiques-${new Date().toISOString().split('T')[0]}.json`);
            res.json(statsData);
        }
    } catch (error) {
        console.error('Erreur export stats:', error);
        res.status(500).json({
            message: 'Erreur serveur',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Fonctions utilitaires
function calculateStartDate(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
}

function formatDate(date) {
    return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit'
    });
}

async function calculateParticipationRate(electionId, startDate) {
    if (electionId) {
        const election = await prisma.election.findUnique({
            where: { id: parseInt(electionId) },
            include: {
                _count: {
                    select: {
                        votes: true,
                        voteTokens: true
                    }
                }
            }
        });

        if (election && election._count.voteTokens > 0) {
            return {
                rate: ((election._count.votes / election._count.voteTokens) * 100).toFixed(1),
                totalVotes: election._count.votes,
                totalVoters: election._count.voteTokens
            };
        }
    }

    // Calcul global si pas d'élection spécifique
    const [totalVotes, totalVoters] = await Promise.all([
        prisma.vote.count({
            where: { createdAt: { gte: startDate } }
        }),
        prisma.voteToken.count({
            where: { createdAt: { gte: startDate } }
        })
    ]);

    return {
        rate: totalVoters > 0 ? ((totalVotes / totalVoters) * 100).toFixed(1) : 0,
        totalVotes,
        totalVoters
    };
}

async function calculateAverageVoteTime(electionId, startDate) {
    // Cette fonction est une simulation
    // Dans une vraie implémentation, vous auriez un champ voteDuration dans votre modèle Vote
    return Math.random() * 10 + 15; // Entre 15 et 25 secondes
}

async function generateExportData(period, electionId) {
    const startDate = calculateStartDate(parseInt(period));

    const [generalStats, votesData, distributionData, hourlyData, comparisonData] = await Promise.all([
        // Données générales
        (async () => {
            const [users, votes, elections, candidates] = await Promise.all([
                prisma.user.count({ where: { createdAt: { gte: startDate } } }),
                prisma.vote.count({
                    where: electionId ? {
                        electionId: parseInt(electionId),
                        createdAt: { gte: startDate }
                    } : { createdAt: { gte: startDate } }
                }),
                prisma.election.count({ where: { createdAt: { gte: startDate } } }),
                prisma.candidate.count({ where: { createdAt: { gte: startDate } } })
            ]);

            const participation = await calculateParticipationRate(electionId, startDate);
            const avgTime = await calculateAverageVoteTime(electionId, startDate);

            return { users, votes, elections, candidates, participationRate: participation.rate, avgVoteTime: avgTime };
        })(),

        // Données votes
        fetch(`${req.protocol}://${req.get('host')}/api/stats/votes?period=${period}${electionId ? `&electionId=${electionId}` : ''}`)
            .then(r => r.json()),

        // Données distribution
        electionId ?
            fetch(`${req.protocol}://${req.get('host')}/api/stats/distribution?electionId=${electionId}`)
                .then(r => r.json())
            : { labels: [], values: [] },

        // Données horaires
        fetch(`${req.protocol}://${req.get('host')}/api/stats/hourly?period=${period}${electionId ? `&electionId=${electionId}` : ''}`)
            .then(r => r.json()),

        // Données comparaison
        fetch(`${req.protocol}://${req.get('host')}/api/stats/comparison?period=${period}`)
            .then(r => r.json())
    ]);

    return {
        metadata: {
            generatedAt: new Date().toISOString(),
            period,
            electionId: electionId || 'all',
            dateRange: { start: startDate.toISOString(), end: new Date().toISOString() }
        },
        general: generalStats,
        votes: votesData,
        distribution: distributionData,
        hourly: hourlyData,
        comparison: comparisonData
    };
}

export default router;