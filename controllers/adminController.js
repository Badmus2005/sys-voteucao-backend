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
            data: {
                temporaryIdentifiant: temporaryCredentials.temporaryIdentifiant,
                temporaryPassword: temporaryCredentials.temporaryPassword,
                expirationDate: temporaryCredentials.expirationDate,
                student: {
                    id: temporaryCredentials.student.id,
                    nom: temporaryCredentials.student.nom,
                    prenom: temporaryCredentials.student.prenom,
                    matricule: temporaryCredentials.student.matricule // Matricule permanent
                }
            }
        });
    } catch (error) {
        console.error('Erreur réinitialisation accès:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

// Rechercher par matricule (pour les années supérieures)
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

// Rechercher par code d'inscription (pour 1ère année)
export const getStudentByCodeInscription = async (req, res) => {
    try {
        const { code } = req.params;

        const student = await prisma.etudiant.findUnique({
            where: { codeInscription: code },
            include: {
                user: true
            }
        });

        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'Étudiant non trouvé avec ce code d\'inscription'
            });
        }

        res.json({
            success: true,
            data: student
        });
    } catch (error) {
        console.error('Erreur recherche étudiant par code:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

export const getAllStudents = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = '' } = req.query;

        const whereClause = search ? {
            OR: [
                { nom: { contains: search, mode: 'insensitive' } },
                { prenom: { contains: search, mode: 'insensitive' } },
                { matricule: { contains: search, mode: 'insensitive' } }, // Recherche par matricule
                { codeInscription: { contains: search, mode: 'insensitive' } }, // Recherche par code
                { filiere: { contains: search, mode: 'insensitive' } }
            ]
        } : {};

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