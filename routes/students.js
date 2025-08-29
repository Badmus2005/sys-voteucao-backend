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




// POST /api/students/:studentId/reset-access - Réinitialiser accès étudiant
router.post('/:studentId/reset-access', async (req, res) => {
    try {
        const { studentId } = req.params;

        // ⚠️ Pour l’instant tu n’as pas req.user (si tu n’as pas encore le système JWT), 
        // donc on met un faux adminId ou null
        const adminId = req.user?.id || null;

        const temporaryCredentials = await PasswordResetService.resetStudentAccess(
            adminId,
            parseInt(studentId) // <= important : ton id d'étudiant est Int en Prisma
        );

        return res.json({
            success: true,
            message: 'Accès réinitialisés avec succès',
            data: {
                temporaryIdentifiant: temporaryCredentials.temporaryIdentifiant,
                temporaryPassword: temporaryCredentials.temporaryPassword,
                expirationDate: temporaryCredentials.expirationDate,
                requirePasswordChange: true,
                student: {
                    id: studentId,
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
});



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



// ============================
// GET /api/students
// Récupérer tous les étudiants avec pagination et filtres
// ============================
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 10, filiere, annee, ecole, status, search } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Filtres de base
        const where = { user: { role: 'ETUDIANT' } };

        if (status === 'active') where.user.actif = true;
        if (status === 'inactive') where.user.actif = false;
        if (filiere) where.filiere = filiere;
        if (annee) where.annee = parseInt(annee);
        if (ecole) where.ecole = ecole;
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
                include: { user: { select: { email: true, actif: true } } },
                skip,
                take: parseInt(limit),
                orderBy: [{ nom: 'asc' }, { prenom: 'asc' }]
            }),
            prisma.etudiant.count({ where })
        ]);

        const formattedStudents = students.map(s => ({
            id: s.id,
            nom: s.nom,
            prenom: s.prenom,
            identifiantTemporaire: s.identifiantTemporaire,
            email: s.user?.email,
            filiere: s.filiere,
            annee: s.annee,
            status: s.user?.actif ? 'Actif' : 'Inactif',
            matricule: s.matricule,
            ecole: s.ecole
        }));

        res.json({
            success: true,
            data: formattedStudents,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ============================
// GET /api/students/stats
// Statistiques globales
// ============================
router.get('/stats', async (req, res) => {
    try {
        const { filiere, annee, ecole } = req.query;
        const where = { user: { role: 'ETUDIANT' } };

        if (filiere) where.filiere = filiere;
        if (annee) where.annee = parseInt(annee);
        if (ecole) where.ecole = ecole;

        const students = await prisma.etudiant.findMany({
            where,
            select: { id: true, user: { select: { actif: true } }, filiere: true, annee: true, ecole: true }
        });

        const totalStudents = students.length;
        const activeStudents = students.filter(s => s.user.actif).length;
        const inactiveStudents = totalStudents - activeStudents;
        const activationRate = totalStudents ? ((activeStudents / totalStudents) * 100).toFixed(2) : '0.00';

        res.json({
            success: true,
            statistics: { totalStudents, activeStudents, inactiveStudents, activationRate }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});


export default router;