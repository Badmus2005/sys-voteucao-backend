import express from 'express';
import multer from 'multer';  // ⬅️ multer fournit memoryStorage()
import axios from 'axios';
import FormData from 'form-data';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = express.Router();

const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload';

// ✅ CONFIGURATION CORRECTE avec memoryStorage
const upload = multer({
  storage: multer.memoryStorage(),  // ⬅️ Utilisation correcte
  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non supporté. Utilisez JPEG ou PNG.'));
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

    console.log('Fichier reçu:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    // Préparer FormData pour ImgBB
    const formData = new FormData();
    formData.append('image', req.file.buffer, {
      filename: req.file.originalname || 'image.jpg',
      contentType: req.file.mimetype
    });

    // Envoyer à ImgBB
    console.log('Envoi à ImgBB...');
    const response = await axios.post(
      `${IMGBB_UPLOAD_URL}?key=${process.env.IMGBB_API_KEY}`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'Content-Type': 'multipart/form-data'
        },
        timeout: 30000
      }
    );

    if (!response.data.success) {
      throw new Error('Échec de l\'upload vers ImgBB');
    }

    const imgbbUrl = response.data.data.url;
    console.log('Upload ImgBB réussi:', imgbbUrl);

    res.json({
      success: true,
      url: imgbbUrl,
      message: 'Image uploadée avec succès'
    });

  } catch (error) {
    console.error('Erreur upload image candidature:', error);

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
    } else if (error.response?.data?.error?.message) {
      errorMessage = error.response.data.error.message;
    }

    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;