import express from 'express';
import prisma from '../prisma.js';
import { authenticateToken, requireAdmin } from '../middlewares/auth.js';
import { PasswordResetService } from '../services/passwordResetService.js';

const router = express.Router();

// GET /api/students - Récupérer tous les étudiants avec pagination et filtres
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 10, filiere, annee, ecole, search, status } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Construire les filtres
        const where = {
            user: {
                role: 'ETUDIANT'
            }
        };

        // Filtre par statut
        if (status === 'active') {
            where.user.actif = true;
        } else if (status === 'inactive') {
            where.user.actif = false;
        }

        // Filtres supplémentaires
        if (filiere) where.filiere = filiere;
        if (annee) where.annee = parseInt(annee);
        if (ecole) where.ecole = ecole;

        // Recherche textuelle
        if (search) {
            where.OR = [
                { nom: { contains: search, mode: 'insensitive' } },
                { prenom: { contains: search, mode: 'insensitive' } },
                { identifiantTemporaire: { contains: search, mode: 'insensitive' } },
                { matricule: { contains: search, mode: 'insensitive' } }
            ];
        }

        const [students, total] = await Promise.all([
            prisma.etudiant.findMany({
                where,
                include: {
                    user: {
                        select: {
                            email: true,
                            actif: true,
                            createdAt: true
                        }
                    }
                },
                skip,
                take: parseInt(limit),
                orderBy: [
                    { nom: 'asc' },
                    { prenom: 'asc' }
                ]
            }),
            prisma.etudiant.count({ where })
        ]);

        // Formater la réponse
        const formattedStudents = students.map(student => ({
            id: student.id,
            nom: student.nom,
            prenom: student.prenom,
            identifiantTemporaire: student.identifiantTemporaire,
            email: student.user?.email,
            filiere: student.filiere,
            annee: student.annee,
            status: student.user?.actif ? 'Actif' : 'Inactif',
            matricule: student.matricule,
            codeInscription: student.codeInscription,
            photoUrl: student.photoUrl,
            ecole: student.ecole,
            createdAt: student.user?.createdAt
        }));

        return res.json({
            success: true,
            data: formattedStudents,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Erreur récupération étudiants:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la récupération des étudiants',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// PUT /api/students/:id/status - Modifier le statut d'un étudiant
router.put('/:id/status', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { actif } = req.body;

        // Vérifier que l'étudiant existe
        const etudiant = await prisma.etudiant.findUnique({
            where: { id: parseInt(id) },
            include: { user: true }
        });

        if (!etudiant || !etudiant.userId) {
            return res.status(404).json({
                success: false,
                message: 'Étudiant non trouvé'
            });
        }

        const updatedUser = await prisma.user.update({
            where: { id: etudiant.userId },
            data: { actif },
            include: {
                etudiant: {
                    select: {
                        id: true,
                        nom: true,
                        prenom: true,
                        filiere: true,
                        annee: true
                    }
                }
            }
        });

        return res.json({
            success: true,
            message: `Étudiant ${actif ? 'activé' : 'désactivé'} avec succès`,
            data: updatedUser
        });
    } catch (error) {
        console.error('Error updating student status:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la modification du statut',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// GET /api/students/stats - Statistiques globales
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { filiere, annee, ecole } = req.query;

        const filterWithUser = {
            ...(filiere && { filiere }),
            ...(annee && { annee: parseInt(annee) }),
            ...(ecole && { ecole }),
            user: { is: { role: 'ETUDIANT' } }
        };

        const etudiantsValides = await prisma.etudiant.findMany({
            where: filterWithUser,
            select: { id: true }
        });

        const ids = etudiantsValides.map(e => e.id);

        if (ids.length === 0) {
            return res.json({
                success: true,
                statistics: {
                    totalStudents: 0,
                    activeStudents: 0,
                    inactiveStudents: 0,
                    activationRate: '0.00'
                },
                byFiliere: [],
                byAnnee: [],
                byEcole: [],
                lastUpdated: new Date().toISOString()
            });
        }

        const [
            totalStudents,
            activeStudents,
            inactiveStudents,
            studentsByFiliere,
            studentsByAnnee,
            studentsByEcole
        ] = await Promise.all([
            Promise.resolve(ids.length),
            prisma.etudiant.count({
                where: { id: { in: ids }, user: { is: { actif: true } } }
            }),
            prisma.etudiant.count({
                where: { id: { in: ids }, user: { is: { actif: false } } }
            }),
            prisma.etudiant.groupBy({
                by: ['filiere'],
                _count: { _all: true },
                where: { id: { in: ids } }
            }),
            prisma.etudiant.groupBy({
                by: ['annee'],
                _count: { _all: true },
                where: { id: { in: ids } }
            }),
            prisma.etudiant.groupBy({
                by: ['ecole'],
                _count: { _all: true },
                where: { id: { in: ids } }
            })
        ]);

        return res.json({
            success: true,
            statistics: {
                totalStudents,
                activeStudents,
                inactiveStudents,
                activationRate: totalStudents > 0
                    ? ((activeStudents / totalStudents) * 100).toFixed(2)
                    : '0.00'
            },
            byFiliere: studentsByFiliere,
            byAnnee: studentsByAnnee,
            byEcole: studentsByEcole,
            lastUpdated: new Date().toISOString()
        });
    } catch (error) {
        console.error('Erreur stats étudiants:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la récupération des statistiques',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// POST /api/students/:studentId/reset-access - Réinitialiser accès étudiant
router.post(
    '/:studentId/reset-access',
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            const { studentId } = req.params;
            const adminId = req.user.id;

            const temporaryCredentials = await PasswordResetService.resetStudentAccess(
                adminId,
                parseInt(studentId)
            );

            return res.json({
                success: true,
                message: 'Accès réinitialisés avec succès',
                data: {
                    temporaryIdentifiant: temporaryCredentials.temporaryIdentifiant,
                    temporaryPassword: temporaryCredentials.temporaryPassword,
                    requirePasswordChange: true,
                    student: {
                        id: parseInt(studentId),
                        nom: temporaryCredentials.student.nom,
                        prenom: temporaryCredentials.student.prenom,
                        matricule: temporaryCredentials.student.matricule
                    }
                }
            });
        } catch (error) {
            console.error('Erreur réinitialisation accès:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la réinitialisation des accès',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// Recherche étudiant par matricule
router.get(
    '/matricule/:matricule',
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            const { matricule } = req.params;

            const student = await prisma.etudiant.findUnique({
                where: { matricule },
                include: {
                    user: {
                        select: {
                            email: true,
                            actif: true,
                            createdAt: true
                        }
                    }
                }
            });

            if (!student) {
                return res.status(404).json({
                    success: false,
                    message: 'Étudiant non trouvé'
                });
            }

            return res.json({
                success: true,
                data: {
                    ...student,
                    status: student.user?.actif ? 'Actif' : 'Inactif'
                }
            });
        } catch (error) {
            console.error('Erreur recherche étudiant:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la recherche étudiant',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// Recherche étudiant par code d'inscription
router.get(
    '/code/:code',
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            const { code } = req.params;

            const student = await prisma.etudiant.findUnique({
                where: { codeInscription: code },
                include: {
                    user: {
                        select: {
                            email: true,
                            actif: true,
                            createdAt: true
                        }
                    }
                }
            });

            if (!student) {
                return res.status(404).json({
                    success: false,
                    message: 'Étudiant non trouvé avec ce code d\'inscription'
                });
            }

            return res.json({
                success: true,
                data: {
                    ...student,
                    status: student.user?.actif ? 'Actif' : 'Inactif'
                }
            });
        } catch (error) {
            console.error('Erreur recherche étudiant par code:', error);
            return res.status(500).json({
                success: false,
                message: 'Erreur lors de la recherche étudiant',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

export default router;