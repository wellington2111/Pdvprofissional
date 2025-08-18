const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  produtosListar: () => ipcRenderer.invoke('produtos:listar'),
  produtosBuscarPorCodigoBarras: (codigoBarras) => ipcRenderer.invoke('produtos:buscar-por-codigo-barras', codigoBarras),
  produtosAdicionar: (produto) => ipcRenderer.invoke('produtos:adicionar', produto),
  produtosAtualizar: (id, produto) => ipcRenderer.invoke('produtos:atualizar', id, produto),
  produtosExcluir: (id) => ipcRenderer.invoke('produtos:excluir', id),
  produtosSalvarImagem: (imageData, fileName) => ipcRenderer.invoke('produtos:salvarImagem', imageData, fileName),
  produtosObterCaminhoImagem: (fileName) => ipcRenderer.invoke('produtos:obterCaminhoImagem', fileName),
  vendasRegistrar: (venda) => ipcRenderer.invoke('vendas:registrar', venda),
  vendasLimparHistorico: () => ipcRenderer.invoke('vendas:limpar-historico'),
  vendasListar: () => ipcRenderer.invoke('vendas:listar'),
  vendaCancelar: (id) => ipcRenderer.invoke('vendas:cancelar', id),
  getUserDataPath: () => ipcRenderer.sendSync('get-user-data-path'),
  showNotification: (title, body) => ipcRenderer.send('show-notification', title, body),
  dashboardDados: (dates) => ipcRenderer.invoke('dashboard:dados', dates),
  categoriasListar: () => ipcRenderer.invoke('categorias:listar'),
  categoriasAdicionar: (nome) => ipcRenderer.invoke('categorias:adicionar', nome),
  reciboGerar: (vendaId, options) => ipcRenderer.invoke('recibo:gerar', vendaId, options)
});
