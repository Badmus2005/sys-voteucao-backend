import express from 'express';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = express.Router();

// GET /api/students - Récupérer tous les étudiants avec pagination et filtres
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 10, filiere, annee, status, search } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);

        // Construction de la clause WHERE
        let whereClause = {
            user: {
                role: 'ETUDIANT'
            }
        };

        // Filtres
        if (filiere && filiere !== 'all') {
            whereClause.filiere = filiere;
        }

        if (annee && annee !== 'all') {
            whereClause.annee = parseInt(annee);
        }

        if (status && status !== 'all') {
            whereClause.user = {
                ...whereClause.user,
                actif: status === 'active'
            };
        }

        // Recherche
        if (search) {
            whereClause.OR = [
                { nom: { contains: search, mode: 'insensitive' } },
                { prenom: { contains: search, mode: 'insensitive' } },
                { matricule: { contains: search, mode: 'insensitive' } },
                { codeInscription: { contains: search, mode: 'insensitive' } },
                { user: { email: { contains: search, mode: 'insensitive' } } }
            ];
        }

        const [students, total] = await Promise.all([
            prisma.etudiant.findMany({
                where: whereClause,
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            actif: true,
                            role: true
                        }
                    }
                },
                orderBy: { nom: 'asc' },
                skip,
                take
            }),
            prisma.etudiant.count({ where: whereClause })
        ]);

        res.json({
            students,
            total,
            page: parseInt(page),
            totalPages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        console.error('Error fetching students:', error);
        res.status(500).json({
            message: 'Erreur serveur lors de la récupération des étudiants',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// PUT /api/students/:id/status - Modifier le statut d'un étudiant
router.put('/:id/status', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { actif } = req.body;

        // Vérifier que l'utilisateur est admin
        const adminUser = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { admin: true }
        });

        if (!adminUser || adminUser.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Accès refusé' });
        }

        // Mettre à jour le statut
        const updatedUser = await prisma.user.update({
            where: { id: parseInt(id) },
            data: { actif },
            include: {
                etudiant: true
            }
        });

        res.json({
            message: `Étudiant ${actif ? 'activé' : 'désactivé'} avec succès`,
            user: updatedUser
        });
    } catch (error) {
        console.error('Error updating student status:', error);
        res.status(500).json({
            message: 'Erreur serveur lors de la modification du statut',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// GET /api/students/stats - Statistiques des étudiants
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const { filiere, annee } = req.query;

        const whereClause = {
            user: {
                role: 'ETUDIANT'
            },
            ...(filiere && { filiere }),
            ...(annee && { annee: parseInt(annee) })
        };

        const [
            totalStudents,
            activeStudents,
            inactiveStudents,
            studentsByFiliere,
            studentsByAnnee
        ] = await Promise.all([
            // Total des étudiants
            prisma.etudiant.count({ where: whereClause }),

            // Étudiants actifs
            prisma.etudiant.count({
                where: {
                    ...whereClause,
                    user: { actif: true }
                }
            }),

            // Étudiants inactifs
            prisma.etudiant.count({
                where: {
                    ...whereClause,
                    user: { actif: false }
                }
            }),

            // Répartition par filière
            prisma.etudiant.groupBy({
                by: ['filiere'],
                _count: { _all: true },
                where: whereClause
            }),

            // Répartition par année
            prisma.etudiant.groupBy({
                by: ['annee'],
                _count: { _all: true },
                where: whereClause
            })
        ]);

        res.json({
            statistics: {
                totalStudents,
                activeStudents,
                inactiveStudents,
                activationRate: totalStudents > 0 ? ((activeStudents / totalStudents) * 100).toFixed(2) : 0
            },
            byFiliere: studentsByFiliere,
            byAnnee: studentsByAnnee,
            lastUpdated: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching student statistics:', error);
        res.status(500).json({
            message: 'Erreur serveur lors de la récupération des statistiques',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

export default router;