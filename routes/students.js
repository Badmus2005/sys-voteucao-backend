import express from 'express';
import prisma from '../prisma.js';
import bcrypt from 'bcrypt';
import { authenticateToken } from '../middlewares/auth.js';

const router = express.Router();

// GET /api/students - Récupérer tous les étudiants avec pagination et filtres
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 10, filiere, annee, status, search, ecole } = req.query;
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

        if (ecole && ecole !== 'all') {
            whereClause.ecole = ecole;
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
        const { filiere, annee, ecole } = req.query;

        // Construction de la clause WHERE avec relations Prisma
        const baseWhere = {
            ...(filiere && { filiere }),
            ...(annee && { annee: parseInt(annee) }),
            ...(ecole && { ecole }),
            user: {
                is: {
                    role: 'ETUDIANT'
                }
            }
        };

        // Requêtes parallèles
        const [
            totalStudents,
            activeStudents,
            inactiveStudents,
            studentsByFiliere,
            studentsByAnnee,
            studentsByEcole
        ] = await Promise.all([
            prisma.etudiant.count({ where: baseWhere }),

            prisma.etudiant.count({
                where: {
                    ...baseWhere,
                    user: {
                        is: {
                            role: 'ETUDIANT',
                            actif: true
                        }
                    }
                }
            }),

            prisma.etudiant.count({
                where: {
                    ...baseWhere,
                    user: {
                        is: {
                            role: 'ETUDIANT',
                            actif: false
                        }
                    }
                }
            }),

            prisma.etudiant.groupBy({
                by: ['filiere'],
                _count: { _all: true },
                where: baseWhere
            }),

            prisma.etudiant.groupBy({
                by: ['annee'],
                _count: { _all: true },
                where: baseWhere
            }),

            prisma.etudiant.groupBy({
                by: ['ecole'],
                _count: { _all: true },
                where: baseWhere
            })
        ]);

        // Réponse structurée
        res.json({
            statistics: {
                totalStudents,
                activeStudents,
                inactiveStudents,
                activationRate: totalStudents > 0
                    ? ((activeStudents / totalStudents) * 100).toFixed(2)
                    : 0
            },
            byFiliere: studentsByFiliere,
            byAnnee: studentsByAnnee,
            byEcole: studentsByEcole,
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


// Route de réinitialisation finale
router.post('/:id/reset-credentials', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Vérifier admin
        const adminUser = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { admin: true }
        });

        if (!adminUser || adminUser.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Accès refusé' });
        }

        // Récupérer l'étudiant
        const etudiant = await prisma.etudiant.findUnique({
            where: { userId: parseInt(id) },
            include: { user: true }
        });

        if (!etudiant) {
            return res.status(404).json({ message: 'Étudiant non trouvé' });
        }

        // GÉNÉRER NOUVEAUX IDENTIFIANTS
        const newEmail = `etu.${etudiant.matricule}@ucao.edu`;
        const newPassword = generateTempPassword();
        const hashedPassword = await bcrypt.hash(newPassword, 12);

        // METTRE À JOUR LE COMPTE
        await prisma.user.update({
            where: { id: parseInt(id) },
            data: {
                email: newEmail,
                password: hashedPassword,
                tempPassword: newPassword, // Stocker temporairement
                requirePasswordChange: true, // Forcer changement
                actif: true // Réactiver si désactivé
            }
        });

        // RÉPONSE
        res.json({
            success: true,
            message: 'Identifiants réinitialisés avec succès',
            credentials: {
                login: newEmail,
                password: newPassword,
                message: 'À changer à la première connexion'
            },
            student: {
                nom: etudiant.nom,
                prenom: etudiant.prenom,
                matricule: etudiant.matricule
            }
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la réinitialisation'
        });
    }
});

export default router;