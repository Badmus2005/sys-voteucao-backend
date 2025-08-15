import express from 'express';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = express.Router();

// Récupérer le profil utilisateur (étudiant ou admin)
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        etudiant: true,
        admin: true
      }
    });

    if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

    const profileData = {
      id: user.id,
      email: user.email,
      role: user.role,
      etudiant: user.etudiant ? {
        matricule: user.etudiant.matricule,
        nom: user.etudiant.nom,
        prenom: user.etudiant.prenom,
        filiere: user.etudiant.filiere,
        annee: user.etudiant.annee,
        photoUrl: user.etudiant.photoUrl
      } : null,
      admin: user.admin ? {
        nom: user.admin.nom,
        prenom: user.admin.prenom,
        poste: user.admin.poste
      } : null
    };

    res.json(profileData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Mettre à jour le profil utilisateur (étudiant ou admin)
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { email, nom, prenom, filiere, annee, poste } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { etudiant: true, admin: true }
    });

    if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

    // Mettre à jour l'email si fourni et différent
    if (email && email !== user.email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing && existing.id !== user.id) {
        return res.status(400).json({ message: 'Email déjà utilisé' });
      }
      await prisma.user.update({ where: { id: user.id }, data: { email } });
    }

    // Étudiant
    if (user.role === 'ETUDIANT' && user.etudiant) {
      const updatedStudent = await prisma.etudiant.update({
        where: { userId: user.id },
        data: {
          ...(nom ? { nom } : {}),
          ...(prenom ? { prenom } : {}),
          ...(filiere ? { filiere } : {}),
          ...(annee ? { annee: parseInt(annee) } : {})
        }
      });
      return res.json({ message: 'Profil étudiant mis à jour', etudiant: updatedStudent });
    }

    // Admin
    if (user.role === 'ADMIN' && user.admin) {
      const updatedAdmin = await prisma.admin.update({
        where: { userId: user.id },
        data: {
          ...(nom ? { nom } : {}),
          ...(prenom ? { prenom } : {}),
          ...(poste ? { poste } : {})
        }
      });
      return res.json({ message: 'Profil admin mis à jour', admin: updatedAdmin });
    }

    res.status(400).json({ message: 'Impossible de mettre à jour le profil' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Élections éligibles pour l'utilisateur
router.get('/elections', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const tokens = await prisma.voteToken.findMany({
      where: {
        userId,
        isUsed: false,
        expiresAt: { gt: new Date() },
        election: { isActive: true }
      },
      include: {
        election: {
          include: {
            candidates: {
              include: { user: { include: { etudiant: true } } }
            },
            _count: { select: { votes: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const elections = tokens.map(t => {
      const hasVoted = t.election.votes.some(v => v.userId === userId);
      return {
        ...t.election,
        hasVoted,
        candidates: t.election.candidates.map(c => ({
          id: c.id,
          nom: c.nom,
          prenom: c.prenom,
          photoUrl: c.photoUrl
        }))
      };
    });

    res.json(elections);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Fil d'actualité: dernières élections clôturées
router.get('/feed', authenticateToken, async (req, res) => {
  try {
    const closedElections = await prisma.election.findMany({
      where: { isActive: false },
      orderBy: { dateFin: 'desc' },
      take: 10,
      include: { candidates: true, _count: { select: { votes: true } } }
    });

    const feed = await Promise.all(closedElections.map(async (e) => {
      const votesGrouped = await prisma.vote.groupBy({
        by: ['candidateId'],
        where: { electionId: e.id },
        _count: { candidateId: true }
      });

      const candidatesWithVotes = e.candidates.map(c => {
        const votesCount = votesGrouped.find(v => v.candidateId === c.id)?._count.candidateId || 0;
        return { ...c, votesCount };
      });

      candidatesWithVotes.sort((a, b) => b.votesCount - a.votesCount);
      const winner = candidatesWithVotes[0] || null;

      return {
        id: e.id,
        titre: e.titre,
        type: e.type,
        dateFin: e.dateFin,
        totalVotes: e._count.votes,
        winner: winner ? {
          id: winner.id,
          nom: winner.nom,
          prenom: winner.prenom,
          votes: winner.votesCount,
          photoUrl: winner.photoUrl
        } : null
      };
    }));

    res.json(feed);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

export default router;
