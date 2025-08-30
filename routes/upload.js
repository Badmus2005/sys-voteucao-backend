import express from 'express';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = express.Router();

const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload';

// Configuration Multer identique à votre route avatar
const upload = multer({
  dest: '/tmp/uploads',  // Utilisez /tmp pour le stockage temporaire
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non supporté (JPEG, PNG uniquement)'));
    }
  }
});

// Route pour l'upload des photos de candidature
router.post('/image', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    console.log('Début upload image candidature');

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Aucun fichier image fourni'
      });
    }

    console.log('Fichier reçu:', req.file);

    // Créer un FormData pour ImgBB
    const formData = new FormData();
    formData.append('image', fs.createReadStream(req.file.path));

    // Envoyer à ImgBB
    console.log('Envoi à ImgBB...');
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

    const imgbbUrl = response.data.data.url;
    console.log('Upload ImgBB réussi:', imgbbUrl);

    // Ici, on ne sauvegarde pas directement dans le profil étudiant
    // On retourne juste l'URL pour qu'elle soit utilisée dans la candidature
    res.json({
      success: true,
      url: imgbbUrl,
      message: 'Image uploadée avec succès'
    });

  } catch (error) {
    console.error('Erreur upload image candidature:', error);

    // Nettoyage du fichier temporaire en cas d'erreur
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    let errorMessage = 'Erreur lors de l\'upload';
    let statusCode = 500;

    if (error.message.includes('Type de fichier non supporté')) {
      errorMessage = 'Type de fichier non supporté (JPEG, PNG uniquement)';
      statusCode = 400;
    } else if (error.message.includes('File too large')) {
      errorMessage = 'Le fichier est trop volumineux (max 2MB)';
      statusCode = 400;
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'Timeout lors de l\'upload';
      statusCode = 408;
    }

    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      details: error.response?.data?.error?.message || error.message
    });
  }
});

export default router;