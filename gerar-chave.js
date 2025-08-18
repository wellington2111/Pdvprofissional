const CryptoJS = require('crypto-js');

function gerarChave(nomeCliente) {
  const segredo = 'SEGREDO_DO_SISTEMA'; // Altere para um segredo forte e mantenha seguro!
  const raw = nomeCliente.trim().toUpperCase() + segredo;
  return CryptoJS.MD5(raw).toString().toUpperCase().match(/.{1,4}/g).join('-');
}

if (process.argv.length < 3) {
  console.log('Uso: node gerar-chave.js "Nome do Cliente"');
  process.exit(1);
}

const nome = process.argv.slice(2).join(' ');
const chave = gerarChave(nome);
console.log(`Chave para "${nome}": ${chave}`);
