import axios from 'axios';
import FormData from 'form-data';
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcrypt';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';
import { url } from 'inspector';

const router = express.Router();
// Configuration ImgBB
const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload';
// Configuration de Multer pour les avatars
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'public/uploads/avatars';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `avatar-${req.user.id}-${Date.now()}${ext}`);
  }
});

const upload = multer({
  dest: '/tmp/uploads',  // Utilisez /tmp pour le stockage temporaire (éphémère sur Railways)
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non supporté (JPEG, PNG, GIF uniquement)'));
    }
  }
});

// Récupérer le profil étudiant
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true }
    });

    if (!user || user.role !== 'ETUDIANT') {
      return res.status(403).json({ message: 'Accès réservé aux étudiants' });
    }

    const etudiant = await prisma.etudiant.findUnique({
      where: { userId: req.user.id },
      include: { user: true }
    });

    if (!etudiant) {
      return res.status(404).json({ message: 'Profil étudiant non trouvé' });
    }

    const profileData = {
      id: etudiant.userId,
      email: etudiant.user.email,
      role: etudiant.user.role,
      matricule: etudiant.matricule,
      codeInscription: etudiant.codeInscription,
      nom: etudiant.nom,
      prenom: etudiant.prenom,
      filiere: etudiant.filiere,
      annee: etudiant.annee,
      photoUrl: etudiant.photoUrl
    };

    res.json(profileData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Mettre à jour le profil étudiant
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { email, nom, prenom, filiere, annee } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true, email: true }
    });

    if (!user || user.role !== 'ETUDIANT') {
      return res.status(403).json({ message: 'Accès réservé aux étudiants' });
    }

    if (email && email !== user.email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return res.status(400).json({ message: 'Email déjà utilisé' });
      }
      await prisma.user.update({
        where: { id: req.user.id },
        data: { email }
      });
    }

    const updatedEtudiant = await prisma.etudiant.update({
      where: { userId: req.user.id },
      data: {
        nom: nom || undefined,
        prenom: prenom || undefined,
        filiere: filiere || undefined,
        annee: annee ? parseInt(annee) : undefined
      }
    });

    res.json({
      message: 'Profil mis à jour avec succès',
      profile: {
        email: email || user.email,
        ...updatedEtudiant
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Changement de photo de profil
router.post('/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Aucun fichier téléchargé' });
    }

    // Créer un FormData pour ImgBB
    const formData = new FormData();
    formData.append('image', fs.createReadStream(req.file.path));

    // Envoyer à ImgBB
    const response = await axios.post(
      `${IMGBB_UPLOAD_URL}?key=${process.env.IMGBB_API_KEY}`,
      formData,
      {
        headers: formData.getHeaders(),
        timeout: 10000
      }
    );

    // Supprimer le fichier temporaire après upload
    fs.unlinkSync(req.file.path);

    if (!response.data.success) {
      throw new Error('Échec de l\'upload vers ImgBB');
    }

    // Mettre à jour l'URL dans la base de données
    const imgbbUrl = response.data.data.url;
    await prisma.etudiant.update({
      where: { userId: req.user.id },
      data: { photoUrl: imgbbUrl }
    });

    res.json({
      success: true,
      photoUrl: imgbbUrl,
      message: 'Avatar mis à jour avec succès'
    });

  } catch (error) {
    console.error('Erreur upload avatar:', error);
    // Nettoyage du fichier temporaire en cas d'erreur
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({
      message: error.response?.data?.error?.message || 'Erreur lors de l\'upload'
    });
  }
});

// Changer le mot de passe
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Tous les champs sont requis' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Le mot de passe doit contenir au moins 8 caractères' });
    }

    // Vérifier l'utilisateur
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { password: true }
    });

    if (!user) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    // Vérifier l'ancien mot de passe
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: 'Mot de passe actuel incorrect' });
    }

    // Hacher et mettre à jour le mot de passe
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashedPassword }
    });

    res.json({
      success: true,
      message: 'Mot de passe changé avec succès'
    });

  } catch (error) {
    console.error('Erreur changement mot de passe:', error);
    res.status(500).json({
      message: 'Erreur lors du changement de mot de passe'
    });
  }
});



export default router;