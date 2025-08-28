// shared/academicHelpers.js
import { ACADEMIC } from '../shared/academicData.js';

export const getAllFilieres = () =>
    Object.values(ACADEMIC.ECOLES).flat();

export const validateEtudiantData = ({ filiere, annee, ecole }) => {
    const errors = [];

    if (filiere && !getAllFilieres().includes(filiere)) {
        errors.push(`Filière invalide : ${filiere}`);
    }

    if (ecole && !Object.keys(ACADEMIC.ECOLES).includes(ecole)) {
        errors.push(`École invalide : ${ecole}`);
    }

    if (annee && !ACADEMIC.ANNEES.includes(Number(annee))) {
        errors.push(`Année invalide : ${annee}`);
    }

    return errors;
};

