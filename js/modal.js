import { $ } from './util.js';
import { cancelOdometer } from './veiculo/manutencao.js';

/* ─── Modais ─── */
function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); if (id === 'odoModal') cancelOdometer(); }

export { closeModal, openModal };
