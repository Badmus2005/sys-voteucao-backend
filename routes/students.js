import express from 'express';
import prisma from '../prisma.js';
import { authenticateToken, requireAdmin } from '../middlewares/auth.js';
import { resetStudentAccess, getStudentByMatricule, getStudentByCodeInscription, getAllStudents } from '../controllers/adminController.js';


const router = express.Router();

// GET /api/students - Récupérer tous les étudiants avec pagination et filtres
router.get('/',
    authenticateToken,
    requireAdmin,
    getAllStudents
);

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


// Route pour réinitialiser les accès d'un étudiant
router.post('/:studentId/reset-access',
    authenticateToken,
    requireAdmin,
    resetStudentAccess
);

// Route pour rechercher un étudiant par matricule (années supérieures)
router.get('/matricule/:matricule',
    authenticateToken,
    requireAdmin,
    getStudentByMatricule
);

// Route pour rechercher un étudiant par code d'inscription (1ère année)
router.get('/code/:code',
    authenticateToken,
    requireAdmin,
    getStudentByCodeInscription
);


export default router;