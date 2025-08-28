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
};

// Recherche par matricule
export const getStudentByMatricule = async (req, res) => {
    try {
        const { matricule } = req.params;

        const student = await prisma.etudiant.findUnique({
            where: { matricule },
            include: { user: true }
        });

        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'Étudiant non trouvé'
            });
        }

        return res.json({
            success: true,
            data: student
        });
    } catch (error) {
        console.error('Erreur recherche étudiant:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur lors de la recherche étudiant',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Recherche par code d'inscription
export const getStudentByCodeInscription = async (req, res) => {
    try {
        const { code } = req.params;

        const student = await prisma.etudiant.findUnique({
            where: { codeInscription: code },
            include: { user: true }
        });

        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'Étudiant non trouvé avec ce code d\'inscription'
            });
        }

        return res.json({
            success: true,
            data: student
        });
    } catch (error) {
        console.error('Erreur recherche étudiant par code:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur lors de la recherche étudiant',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Liste avec pagination + recherche
export const getAllStudents = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = '' } = req.query;

        // Version simplifiée sans filtres complexes
        const students = await prisma.etudiant.findMany({
            skip: (parseInt(page) - 1) * parseInt(limit),
            take: parseInt(limit),
            orderBy: { nom: 'asc' }
        });

        const total = await prisma.etudiant.count();

        return res.json({
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
        console.error('Erreur:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur serveur'
        });
    }
};
