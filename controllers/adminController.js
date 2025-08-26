import { PasswordResetService } from '../services/passwordResetService.js';
import prisma from '../prisma.js';

export const resetStudentAccess = async (req, res) => {
    try {
        const { studentId } = req.params;
        const adminId = req.user.id;

        const temporaryCredentials = await PasswordResetService.resetStudentAccess(
            adminId,
            parseInt(studentId)
        );

        res.json({
            success: true,
            message: 'Accès réinitialisés avec succès',
            data: temporaryCredentials
        });
    } catch (error) {
        console.error('Erreur réinitialisation accès:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const getStudentByMatricule = async (req, res) => {
    try {
        const { matricule } = req.params;

        const student = await prisma.etudiant.findUnique({
            where: { matricule },
            include: {
                user: true
            }
        });

        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'Étudiant non trouvé'
            });
        }

        res.json({
            success: true,
            data: student
        });
    } catch (error) {
        console.error('Erreur recherche étudiant:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const getAllStudents = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = '' } = req.query;

        const whereClause = {
            OR: [
                { nom: { contains: search, mode: 'insensitive' } },
                { prenom: { contains: search, mode: 'insensitive' } },
                { matricule: { contains: search, mode: 'insensitive' } },
                { filiere: { contains: search, mode: 'insensitive' } }
            ]
        };

        const [students, total] = await Promise.all([
            prisma.etudiant.findMany({
                where: whereClause,
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            requirePasswordChange: true
                        }
                    }
                },
                skip: (parseInt(page) - 1) * parseInt(limit),
                take: parseInt(limit),
                orderBy: { nom: 'asc' }
            }),
            prisma.etudiant.count({ where: whereClause })
        ]);

        res.json({
            success: true,
            data: {
                students,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / parseInt(limit))
                }
            }
        });
    } catch (error) {
        console.error('Erreur liste étudiants:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};