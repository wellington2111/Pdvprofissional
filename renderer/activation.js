window.addEventListener('DOMContentLoaded', () => {
  const activationStatus = document.getElementById('activation-status');
  const activationForm = document.getElementById('activation-form');
  const activationMessage = document.getElementById('activation-message');

  // Check activation status
  // window.electronAPI já está disponível via preload.js
  const activationPath = 'activation.json'; // Caminho virtual, só para referência
  // Armazenar ativação no localStorage para simplificar o fluxo offline


  function checkActivation() {
    const data = JSON.parse(localStorage.getItem('activationData') || 'null');
    if (data && data.activated) {
      activationStatus.textContent = 'Ativado!';
      activationForm.style.display = 'none';
      const menu = document.getElementById('menu-pdv');
      if (menu) menu.style.display = 'block';
    } else {
      activationStatus.textContent = 'Não ativado!';
      activationForm.style.display = 'block';
    }
  }

  activationForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const key = document.getElementById('activation-key').value;
    const nomeCliente = document.getElementById('activation-nome').value;
    const segredo = 'SEGREDO_DO_SISTEMA'; // Use o mesmo segredo do gerar-chave.js
    // CryptoJS deve estar disponível globalmente via <script> em index.html
    const raw = nomeCliente.trim().toUpperCase() + segredo;
    const chaveEsperada = window.CryptoJS.MD5(raw).toString().toUpperCase().match(/.{1,4}/g).join('-');
    if (key === chaveEsperada) {
      localStorage.setItem('activationData', JSON.stringify({ activated: true, key, nomeCliente }));
      activationMessage.textContent = 'Ativado com sucesso!';
      checkActivation();
      const menu = document.getElementById('menu-pdv');
      if (menu) menu.style.display = 'block';
    } else {
      activationMessage.textContent = 'Chave inválida!';
    }
  });

  checkActivation();
});
