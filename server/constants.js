'use strict';

const MONTHS = ['JANVIER', 'FEVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET', 'AOUT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DECEMBRE'];

const ZONES = [
  { id: 'A', nom: 'ZONE A', region: 'Nord-Ouest', color: '#1A7A3A' },
  { id: 'B', nom: 'ZONE B', region: 'Nord-Est', color: '#1A4A92' },
  { id: 'C', nom: 'ZONE C', region: 'Centre-Ouest', color: '#7B3FA0' },
  { id: 'D', nom: 'ZONE D', region: 'Centre-Est', color: '#B8861B' },
  { id: 'E', nom: 'ZONE E', region: 'Sud-Ouest', color: '#C0392B' },
  { id: 'F', nom: 'ZONE F', region: 'Sud-Est', color: '#16878C' },
];

const ROLES = ['admin', 'operateur', 'lecteur'];

// Types de documents acceptés dans les dossiers de zone.
const DOC_TYPES = {
  pptx: 'PPTX', ppt: 'PPTX', pdf: 'PDF', docx: 'DOCX', doc: 'DOCX',
};
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic'];
const VIDEO_EXT = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'mpg', 'mpeg', 'ts', 'mts', 'wmv'];

const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic',
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska', webm: 'video/webm',
  m4v: 'video/x-m4v', mpg: 'video/mpeg', mpeg: 'video/mpeg', ts: 'video/mp2t', mts: 'video/mp2t', wmv: 'video/x-ms-wmv',
};

module.exports = { MONTHS, ZONES, ROLES, DOC_TYPES, IMAGE_EXT, VIDEO_EXT, MIME_BY_EXT };
