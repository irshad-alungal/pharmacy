import { mountShell } from './navigation.js';
const prof = await mountShell('whatsapp', 'WhatsApp');
document.getElementById('view').innerHTML =
  '<div class="notice">STUB: the WhatsApp module is not implemented yet. Page shell, navigation and role check are working.</div>';
