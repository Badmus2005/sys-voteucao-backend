
import axios from 'axios';
import FormData from 'form-data';
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';


const router = express.Router();
// Configuration ImgBB
const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload';

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

router.post('/image', authenticateToken, upload.single('image'), async (req, res) => {
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
    await prisma.candidate.update({
      where: { userId: req.user.id },
      data: { photoUrl: imgbbUrl }
    });

    res.json({
      success: true,
      photoUrl: imgbbUrl,
      url: imgbbUrl,
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



export default router;