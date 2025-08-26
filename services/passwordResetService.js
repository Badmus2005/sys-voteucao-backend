import bcrypt from 'bcrypt';
import prisma from '../prisma.js';

export class PasswordResetService {
    static async resetStudentAccess(adminId, studentId) {
        try {
            // Récupérer l'étudiant avec son utilisateur
            const student = await prisma.etudiant.findUnique({
                where: { id: studentId },
                include: { user: true }
            });

            if (!student || !student.user) {
                throw new Error('Étudiant non trouvé');
            }

            // Générer des identifiants temporaires
            const temporaryIdentifiant = `temp_${Math.random().toString(36).substring(2, 10)}`;
            const temporaryPassword = this.generateTempPassword(12);

            // Calculer la date d'expiration (24 heures)
            const expirationDate = new Date();
            expirationDate.setHours(expirationDate.getHours() + 24);

            // Mettre à jour l'étudiant et l'utilisateur
            const updatedStudent = await prisma.$transaction(async (tx) => {
                // Mettre à jour l'utilisateur
                await tx.user.update({
                    where: { id: student.user.id },
                    data: {
                        tempPassword: await bcrypt.hash(temporaryPassword, 10),
                        requirePasswordChange: true,
                        passwordResetExpires: expirationDate
                    }
                });

                // Mettre à jour l'étudiant
                const updated = await tx.etudiant.update({
                    where: { id: studentId },
                    data: {
                        identifiantTemporaire: temporaryIdentifiant
                    },
                    include: {
                        user: true
                    }
                });

                return updated;
            });

            // Journaliser l'action
            await prisma.activityLog.create({
                data: {
                    action: 'RESET_STUDENT_ACCESS',
                    details: `Réinitialisation des accès pour l'étudiant ${studentId} (${student.nom} ${student.prenom})`,
                    userId: adminId
                }
            });

            return {
                temporaryIdentifiant,
                temporaryPassword,
                expirationDate,
                student: {
                    nom: updatedStudent.nom,
                    prenom: updatedStudent.prenom,
                    matricule: updatedStudent.matricule
                }
            };

        } catch (error) {
            throw new Error(`Erreur lors de la réinitialisation: ${error.message}`);
        }
    }

    static async validateTemporaryCredentials(identifiant, password) {
        try {
            const student = await prisma.etudiant.findFirst({
                where: {
                    identifiantTemporaire: identifiant
                },
                include: {
                    user: true
                }
            });

            if (!student || !student.user) {
                throw new Error('Identifiant temporaire invalide');
            }

            // Vérifier l'expiration
            if (student.user.passwordResetExpires && student.user.passwordResetExpires < new Date()) {
                throw new Error('Identifiants temporaires expirés');
            }

            // Vérifier le mot de passe
            const isValid = await bcrypt.compare(password, student.user.tempPassword || '');
            if (!isValid) {
                throw new Error('Mot de passe temporaire incorrect');
            }

            return student;
        } catch (error) {
            throw new Error(`Validation échouée: ${error.message}`);
        }
    }

    static async completePasswordReset(userId, newPassword) {
        try {
            const hashedPassword = await bcrypt.hash(newPassword, 10);

            await prisma.$transaction([
                // Mettre à jour le mot de passe principal et nettoyer les temporaires
                prisma.user.update({
                    where: { id: userId },
                    data: {
                        password: hashedPassword,
                        tempPassword: null,
                        requirePasswordChange: false,
                        passwordResetExpires: null
                    }
                }),

                // Nettoyer l'identifiant temporaire
                prisma.etudiant.update({
                    where: { userId: userId },
                    data: {
                        identifiantTemporaire: null
                    }
                })
            ]);

        } catch (error) {
            throw new Error(`Erreur lors du changement de mot de passe: ${error.message}`);
        }
    }

    static generateTempPassword(length = 12) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
        let password = '';

        for (let i = 0; i < length; i++) {
            password += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        return password;
    }
}