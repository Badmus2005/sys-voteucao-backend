import express from 'express';
import prisma from '../prisma.js';
import { authenticateToken, requireAdmin } from '../middlewares/auth.js';
import {
    resetStudentAccess,
    getStudentByMatricule,
    getStudentByCodeInscription,
    getAllStudents
} from '../controllers/adminController.js';

const router = express.Router();

// GET /api/students - Récupérer tous les étudiants avec pagination et filtres
router.get(
    '/',
    authenticateToken,
    requireAdmin,
    getAllStudents
);

// PUT /api/students/:id/status - Activer/désactiver un étudiant
router.put('/:id/status', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { actif } = req.body;

        const updatedUser = await prisma.user.update({
            where: { id: parseInt(id) },
            data: { actif },
            include: { etudiant: true }
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
    resetStudentAccess
);

// Recherche étudiant par matricule
router.get(
    '/matricule/:matricule',
    authenticateToken,
    requireAdmin,
    getStudentByMatricule
);

// Recherche étudiant par code d'inscription
router.get(
    '/code/:code',
    authenticateToken,
    requireAdmin,
    getStudentByCodeInscription
);

export default router;
