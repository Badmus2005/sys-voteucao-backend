import axios from 'axios';
import FormData from 'form-data';
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = express.Router();
const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload';

// ✅ Correction : Utilisation de memoryStorage au lieu de stockage disque
const upload = multer({
  storage: multer.memoryStorage(),  // ← CHANGEMENT IMPORTANT
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non supporté (JPEG, PNG uniquement)'));
    }
  }
});

router.post('/image', authenticateToken, upload.single('image'), async (req, res) => {
  console.log('=== UPLOAD START ===');

  try {
    if (!req.file) {
      console.log('No file received');
      return res.status(400).json({
        success: false,
        message: 'Aucun fichier image fourni'
      });
    }

    console.log('File received:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      bufferLength: req.file.buffer?.length
    });

    // ✅ Correction : Utilisation du buffer mémoire au lieu de fichiers temporaires
    const formData = new FormData();
    formData.append('image', req.file.buffer, {
      filename: req.file.originalname || 'image.jpg',
      contentType: req.file.mimetype
    });

    console.log('Sending to ImgBB...');

    // Envoyer à ImgBB
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

    console.log('ImgBB response:', response.data);

    if (!response.data.success) {
      throw new Error('Échec de l\'upload vers ImgBB: ' + JSON.stringify(response.data));
    }

    const imgbbUrl = response.data.data.url;
    console.log('Upload successful:', imgbbUrl);

    // ✅ Correction : NE PAS mettre à jour la table Candidate ici
    // Juste retourner l'URL, la candidature sera créée ensuite
    res.json({
      success: true,
      url: imgbbUrl,
      message: 'Image uploadée avec succès'
    });

  } catch (error) {
    console.error('Upload error details:', error);

    let errorMessage = 'Erreur lors de l\'upload';
    let statusCode = 500;

    if (error.message.includes('Type de fichier non supporté')) {
      errorMessage = 'Type de fichier non supporté';
      statusCode = 400;
    } else if (error.message.includes('File too large')) {
      errorMessage = 'Fichier trop volumineux (max 2MB)';
      statusCode = 400;
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


/*import axios from 'axios';
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



export default router;*/