import bcrypt from 'bcrypt';
import prisma from '../prisma.js';

export class PasswordResetService {
    // Génère un mot de passe temporaire lisible pour l'admin (retourné en clair)
    static generateTempPassword(length = 12) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
        let password = '';
        for (let i = 0; i < length; i++) {
            password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return password;
    }

    /**
     * Réinitialisation des accès par un admin.
     * - Ne modifie PAS le password principal.
     * - Ecrit tempPassword (hashé), requirePasswordChange = true, passwordResetExpires.
     * - Crée identifiantTemporaire si absent.
     */
    static async resetStudentAccess(adminId, studentId) {
        try {
            const student = await prisma.etudiant.findUnique({
                where: { id: studentId },
                include: { user: true }
            });

            if (!student || !student.user) {
                throw new Error('Étudiant non trouvé ou sans compte lié');
            }

            // Générer identifiant temporaire si absent
            let temporaryIdentifiant = student.identifiantTemporaire;
            if (!temporaryIdentifiant) {
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                let idt = '';
                for (let i = 0; i < 8; i++) idt += chars.charAt(Math.floor(Math.random() * chars.length));
                temporaryIdentifiant = `TEMP${idt}`;
            }

            const temporaryPasswordPlain = this.generateTempPassword(12);
            const temporaryPasswordHash = await bcrypt.hash(temporaryPasswordPlain, 10);

            // expiration (24h)
            const expirationDate = new Date();
            expirationDate.setHours(expirationDate.getHours() + 24);

            // Transaction : update user (tempPassword + require flag + expiry) et etudiant (identifiant si absent)
            const updated = await prisma.$transaction(async (tx) => {
                await tx.user.update({
                    where: { id: student.user.id },
                    data: {
                        tempPassword: temporaryPasswordHash,         // champ existant dans ton schéma
                        requirePasswordChange: true,
                        passwordResetExpires: expirationDate
                        // NE PAS TOUCHER à `password` principal
                    }
                });

                const updatedStudent = await tx.etudiant.update({
                    where: { id: studentId },
                    data: {
                        identifiantTemporaire: temporaryIdentifiant
                    },
                    include: { user: true }
                });

                // Log d'activité si tu as la table activityLog
                if (tx.activityLog) {
                    try {
                        await tx.activityLog.create({
                            data: {
                                action: 'RESET_STUDENT_ACCESS',
                                details: `Admin ${adminId} reset student ${studentId}`,
                                userId: adminId
                            }
                        });
                    } catch (err) {
                        // Ne pas bloquer la requête si le log échoue
                        console.warn('Activity log failed (non blocking):', err.message);
                    }
                }

                return updatedStudent;
            });

            return {
                temporaryIdentifiant,
                temporaryPassword: temporaryPasswordPlain,
                expirationDate,
                student: {
                    nom: updated.nom,
                    prenom: updated.prenom,
                    matricule: updated.matricule
                }
            };
        } catch (error) {
            throw new Error(`Erreur lors de la réinitialisation: ${error.message}`);
        }
    }

    /**
     * Valide les credentials temporaires fournis par l'étudiant (identifiantTemporaire + mot de passe temporaire)
     */
    static async validateTemporaryCredentials(identifiant, password) {
        try {
            const student = await prisma.etudiant.findFirst({
                where: { identifiantTemporaire: identifiant },
                include: { user: true }
            });

            if (!student || !student.user) {
                throw new Error('Identifiant temporaire invalide');
            }

            // Vérifier expiration si présente
            if (student.user.passwordResetExpires && student.user.passwordResetExpires < new Date()) {
                throw new Error('Identifiants temporaires expirés');
            }

            const isValid = await bcrypt.compare(password, student.user.tempPassword || '');
            if (!isValid) {
                throw new Error('Mot de passe temporaire incorrect');
            }

            // retourne le student + user (comportement actuel attendu)
            return student;
        } catch (error) {
            throw new Error(`Validation échouée: ${error.message}`);
        }
    }

    /**
     * Complète le changement de mot de passe après une connexion temporaire.
     * - Remplace password par le nouveau hash
     * - Vide tempPassword, passwordResetExpires
     * - passe requirePasswordChange à false
     * - **Ne supprime pas** identifiantTemporaire (on garde l'identifiant créé à l'inscription)
     */
    static async completePasswordReset(userId, newPassword) {
        try {
            const hashed = await bcrypt.hash(newPassword, 10);

            await prisma.$transaction([
                prisma.user.update({
                    where: { id: userId },
                    data: {
                        password: hashed,
                        tempPassword: null,
                        requirePasswordChange: false,
                        passwordResetExpires: null
                    }
                })
                // On NE supprime PAS l'identifiantTemporaire : on le laisse intact.
            ]);

            return true;
        } catch (error) {
            throw new Error(`Erreur lors du changement de mot de passe: ${error.message}`);
        }
    }
}
