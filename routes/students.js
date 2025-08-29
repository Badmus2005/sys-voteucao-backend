import express from 'express';
import prisma from '../prisma.js';
import { authenticateToken, requireAdmin } from '../middlewares/auth.js';
import { PasswordResetService } from '../services/passwordResetService.js';

const router = express.Router();

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



// 📌 Route : récupérer tous les étudiants
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const students = await prisma.etudiant.findMany();

        res.json(students.map(student => ({
            id: student.id,
            matricule: student.matricule,
            nom: student.nom,
            prenom: student.prenom,
            ecole: student.ecole,
            annee: student.annee
        })));
    } catch (error) {
        console.error("Erreur lors de la récupération des étudiants:", error);
        res.status(500).json({ error: "Erreur serveur lors de la récupération des étudiants" });
    }
});

// 📌 Route : récupérer les statistiques des étudiants
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const totalStudents = await prisma.etudiant.count();

        res.json({
            totalStudents
        });
    } catch (error) {
        console.error("Erreur lors de la récupération des statistiques:", error);
        res.status(500).json({ error: "Erreur serveur lors de la récupération des statistiques" });
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