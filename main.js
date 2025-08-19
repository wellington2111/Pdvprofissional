const { app, BrowserWindow, ipcMain, dialog, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

// Define o caminho do banco de dados na pasta de dados do usuário
const dbPath = path.join(app.getPath('userData'), 'pdv-database.db');

// Cria a conexão com o banco de dados
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    // Em caso de erro na conexão, exibe um erro e encerra o app
    dialog.showErrorBox('Erro Crítico de Banco de Dados', `Não foi possível conectar ao banco de dados: ${err.message}. A aplicação será encerrada.`);
    app.quit();
  }
});

// Mantém referências de janelas de pré-visualização para evitar GC automático
const receiptPreviews = new Set();

// --- Funções Utilitárias de Banco de Dados (com Promises) ---
// Função para executar queries que não retornam linhas (INSERT, UPDATE, DELETE)
function dbRun(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) {
        console.error('Erro na query DB (run):', query, params, err);
        reject(err);
      } else {
        resolve(this); // Retorna o contexto (lastID, changes)
      }
    });
  });
}

// Função para buscar todas as linhas que correspondem à query
function dbAll(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) {
        console.error('Erro na query DB (all):', query, params, err);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Função para buscar uma única linha
function dbGet(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) {
        console.error('Erro na query DB (get):', query, params, err);
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// --- Inicialização e Migração do Banco de Dados ---
async function initializeDatabase() {
  console.log('Iniciando verificação e migração do banco de dados...');
  // Habilita chaves estrangeiras
  await dbRun('PRAGMA foreign_keys = ON');

  // Cria as tabelas se não existirem
  await dbRun(`CREATE TABLE IF NOT EXISTS produtos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    preco REAL NOT NULL,
    estoque INTEGER NOT NULL
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS vendas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL,
    total REAL NOT NULL,
    metodo_pagamento TEXT NOT NULL
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS itens_venda (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id INTEGER NOT NULL,
    produto_id INTEGER,
    nome TEXT NOT NULL,
    quantidade INTEGER NOT NULL,
    preco_unitario REAL NOT NULL,
    FOREIGN KEY (venda_id) REFERENCES vendas(id) ON DELETE CASCADE,
    FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE SET NULL
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS categorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE
  )`);

  // Adiciona colunas que podem estar faltando em instalações existentes (migração)
  const productColumns = await dbAll('PRAGMA table_info(produtos)');
  const productColumnNames = productColumns.map(c => c.name);
  if (!productColumnNames.includes('imagem')) {
    await dbRun('ALTER TABLE produtos ADD COLUMN imagem TEXT');
  }
  if (!productColumnNames.includes('codigo_barras')) {
    await dbRun('ALTER TABLE produtos ADD COLUMN codigo_barras TEXT');
    await dbRun('CREATE UNIQUE INDEX IF NOT EXISTS idx_produtos_codigo_barras ON produtos (codigo_barras)');
  }
  if (!productColumnNames.includes('categoria_id')) {
    await dbRun('ALTER TABLE produtos ADD COLUMN categoria_id INTEGER REFERENCES categorias(id)');
  }

  const salesColumns = await dbAll('PRAGMA table_info(vendas)');
  const salesColumnNames = salesColumns.map(c => c.name);
  if (!salesColumnNames.includes('status')) {
    await dbRun(`ALTER TABLE vendas ADD COLUMN status TEXT DEFAULT 'concluida'`);
  }
  if (!salesColumnNames.includes('valor_recebido')) {
    await dbRun(`ALTER TABLE vendas ADD COLUMN valor_recebido REAL`);
  }
  if (!salesColumnNames.includes('troco')) {
    await dbRun(`ALTER TABLE vendas ADD COLUMN troco REAL`);
  }

  // --- Criação de Índices para Performance ---
  // Acelera a busca de vendas por data (essencial para relatórios e dashboard)
  await dbRun('CREATE INDEX IF NOT EXISTS idx_vendas_data ON vendas (data)');
  
  // Acelera a junção de vendas com seus itens (essencial para relatórios)
  await dbRun('CREATE INDEX IF NOT EXISTS idx_itens_venda_venda_id ON itens_venda (venda_id)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_itens_venda_produto_id ON itens_venda (produto_id)');

  // Acelera o filtro de produtos por categoria
  await dbRun('CREATE INDEX IF NOT EXISTS idx_produtos_categoria_id ON produtos (categoria_id)');

  console.log('Banco de dados pronto para uso.');
}

// --- Configuração dos Handlers do IPC ---
function setupIpcHandlers() {
  // Handlers de Categorias
  ipcMain.handle('categorias:listar', () => dbAll('SELECT * FROM categorias ORDER BY nome ASC'));
  ipcMain.handle('categorias:adicionar', async (event, nome) => {
    try {
      const result = await dbRun('INSERT INTO categorias (nome) VALUES (?)', [nome]);
      return { id: result.lastID, nome };
    } catch (error) {
      console.error('Erro ao adicionar categoria:', error);
      throw error;
    }
  });

  // Handlers de Produtos
  ipcMain.handle('produtos:listar', () => 
    dbAll(`
      SELECT p.*, c.nome as categoria_nome 
      FROM produtos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      ORDER BY p.nome ASC
    `)
  );

  ipcMain.handle('produtos:adicionar', (event, produto) => {
    const { nome, preco, estoque, imagem, codigo_barras, categoria_id } = produto;
    const query = 'INSERT INTO produtos (nome, preco, estoque, imagem, codigo_barras, categoria_id) VALUES (?, ?, ?, ?, ?, ?)';
    const params = [nome, preco, estoque, imagem || null, codigo_barras || null, categoria_id || null];
    return dbRun(query, params);
  });

  ipcMain.handle('produtos:atualizar', (event, id, produto) => {
    const { nome, preco, estoque, imagem, codigo_barras, categoria_id } = produto;
    const query = 'UPDATE produtos SET nome = ?, preco = ?, estoque = ?, imagem = ?, codigo_barras = ?, categoria_id = ? WHERE id = ?';
    const params = [nome, preco, estoque, imagem || null, codigo_barras || null, categoria_id || null, id];
    return dbRun(query, params);
  });

  ipcMain.handle('produtos:buscar-por-codigo-barras', async (event, codigoBarras) => {
    const row = await dbGet('SELECT * FROM produtos WHERE codigo_barras = ?', [codigoBarras]);
    if (row) {
      // Mapeia os campos do banco para os nomes esperados pelo frontend
      return {
        id: row.id,
        name: row.nome,
        price: row.preco,
        stock: row.estoque,
        image: row.imagem,
        codigo_barras: row.codigo_barras
      };
    }
    return null; // Retorna nulo se não encontrar
  });

  ipcMain.handle('produtos:excluir', async (event, id) => {
    const row = await dbGet('SELECT imagem FROM produtos WHERE id = ?', [id]);
    if (row && row.imagem) {
      const imagePath = path.join(app.getPath('userData'), 'product-images', row.imagem);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }
    return dbRun('DELETE FROM produtos WHERE id = ?', [id]);
  });

  ipcMain.handle('vendas:listar', async () => {
    const vendas = await dbAll('SELECT * FROM vendas ORDER BY data DESC');
    for (const venda of vendas) {
      venda.itens = await dbAll('SELECT * FROM itens_venda WHERE venda_id = ?', [venda.id]);
    }
    return vendas;
  });

  ipcMain.handle('vendas:cancelar', async (event, vendaId) => {
    await dbRun('BEGIN TRANSACTION');
    try {
      await dbRun('UPDATE vendas SET status = ? WHERE id = ?', ['cancelada', vendaId]);
      const itens = await dbAll('SELECT produto_id, quantidade FROM itens_venda WHERE venda_id = ?', [vendaId]);
      for (const item of itens) {
        if (item.produto_id) { // Verifica se o produto ainda existe
          await dbRun('UPDATE produtos SET estoque = estoque + ? WHERE id = ?', [item.quantidade, item.produto_id]);
        }
      }
      await dbRun('COMMIT');
      return { success: true };
    } catch (error) {
      await dbRun('ROLLBACK');
      throw error;
    }
  });

  ipcMain.handle('vendas:registrar', async (event, vendaData) => {
    const { total, metodoPagamento, itens, valorRecebido = null, troco = 0 } = vendaData;
    await dbRun('BEGIN TRANSACTION');
    try {
      const result = await dbRun('INSERT INTO vendas (data, total, metodo_pagamento, status, valor_recebido, troco) VALUES (datetime(\'now\', \'localtime\'), ?, ?, ?, ?, ?)', [total, metodoPagamento, 'concluida', valorRecebido, troco]);
      const vendaId = result.lastID;

      for (const item of itens) {
        await dbRun('INSERT INTO itens_venda (venda_id, produto_id, nome, quantidade, preco_unitario) VALUES (?, ?, ?, ?, ?)', [vendaId, item.id, item.name, item.quantidade, item.price]);
        await dbRun('UPDATE produtos SET estoque = estoque - ? WHERE id = ?', [item.quantidade, item.id]);
      }
      await dbRun('COMMIT');
      return { success: true, vendaId };
    } catch (error) {
      await dbRun('ROLLBACK');
      console.error('Erro ao registrar venda:', error);
      throw error;
    }
  });

  ipcMain.handle('vendas:limpar-historico', () => dbRun('DELETE FROM vendas'));

  ipcMain.handle('produtos:salvarImagem', (event, imageData, fileName) => {
    const imagesDir = path.join(app.getPath('userData'), 'product-images');
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }
    const newFileName = `produto_${Date.now()}${path.extname(fileName)}`;
    const filePath = path.join(imagesDir, newFileName);
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    return newFileName;
  });

  ipcMain.on('show-notification', (event, title, body) => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
        new Notification({ title: title, body: body }).show();
    }
  });

  // --- Geração de Recibo em PDF ---
  ipcMain.handle('recibo:gerar', async (event, vendaId, options = {}) => {
    try {
      if (!vendaId) throw new Error('ID da venda não informado');
      const largura = String(options.largura || '80'); // '80' ou '58' mm
      const widthMm = largura === '58' ? 58 : 80;
      const pageWidthMicrons = widthMm * 1000; // Electron usa micrômetros
      const pageHeightMicrons = 500000; // 500mm (suficiente para recibos comuns)

      // Busca dados da venda e itens
      const venda = await dbGet(`SELECT id, data, total, metodo_pagamento, valor_recebido, troco FROM vendas WHERE id = ?`, [vendaId]);
      if (!venda) throw new Error('Venda não encontrada');
      const itens = await dbAll(`SELECT nome, quantidade, preco_unitario FROM itens_venda WHERE venda_id = ?`, [vendaId]);

      // Monta HTML simples do recibo
      const formatCurrency = (v) => (typeof v === 'number' ? `R$ ${v.toFixed(2).replace('.', ',')}` : 'R$ 0,00');
      const dataLocal = new Date(venda.data);
      const dataStr = isNaN(dataLocal.getTime()) ? venda.data : dataLocal.toLocaleString();

      const itensRows = (itens || []).map(it => `
        <tr>
          <td>${(it.nome || '').toString()}</td>
          <td style="text-align:center">${it.quantidade}</td>
          <td style="text-align:right">${formatCurrency(it.preco_unitario)}</td>
          <td style="text-align:right">${formatCurrency((it.preco_unitario || 0) * (it.quantidade || 0))}</td>
        </tr>`).join('');

      const recebidoStr = (typeof venda.valor_recebido === 'number' && !isNaN(venda.valor_recebido)) ? formatCurrency(venda.valor_recebido) : '';
      const trocoStr = (typeof venda.troco === 'number' && !isNaN(venda.troco)) ? formatCurrency(venda.troco) : '';

      const html = `<!doctype html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Recibo #${venda.id}</title>
        <style>
          @page { size: ${widthMm}mm auto; margin: 0; }
          body { font-family: 'DejaVu Sans', Arial, sans-serif; margin: 0; padding: 6mm 4mm; width: ${widthMm}mm; }
          h1 { font-size: 14px; margin: 0 0 2mm; text-align: center; }
          .muted { color: #444; font-size: 10px; text-align: center; }
          hr { border: 0; border-top: 1px dashed #999; margin: 3mm 0; }
          table { width: 100%; border-collapse: collapse; margin-top: 2mm; }
          th, td { padding: 1mm 0; border-bottom: 1px dashed #e0e0e0; font-size: 10px; }
          th { text-align: left; background: none; border-bottom: 1px solid #000; }
          .right { text-align: right; }
          .center { text-align:center; }
          .totais { margin-top: 2mm; text-align: right; font-size: 12px; }
          .footer { margin-top: 3mm; font-size: 10px; text-align: center; }
        </style>
      </head>
      <body>
        <h1>Recibo de Venda</h1>
        <div class="muted">Venda #${venda.id}</div>
        <div class="muted">Data: ${dataStr}</div>
        <div class="muted">Pagamento: ${(venda.metodo_pagamento || '').toString().trim().toLowerCase().replace(/^./, c => c.toUpperCase())}</div>
        <hr />
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th class="center">Qtd</th>
              <th class="right">Preço</th>
              <th class="right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itensRows || '<tr><td colspan="4" class="center">Sem itens</td></tr>'}
          </tbody>
        </table>
        <div class="totais"><strong>Total:</strong> ${formatCurrency(venda.total)}</div>
        ${recebidoStr ? `<div class="totais"><strong>Recebido:</strong> ${recebidoStr}</div>` : ''}
        ${trocoStr ? `<div class="totais"><strong>Troco:</strong> ${trocoStr}</div>` : ''}
        <div class="footer">Documento não fiscal</div>
      </body>
      </html>`;

      // HTML somente para pré-visualização com botão de imprimir (não aparece no PDF)
      const htmlPreview = `<!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Recibo #${venda.id}</title>
        <style>
          #printBtn { position: fixed; top: 10px; right: 10px; z-index: 9999; background: #4caf50; color: #fff; border: 0; border-radius: 6px; padding: 8px 12px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
          #printBtn:hover { background: #43a047; }
          @media print { #printBtn { display: none; } }
        </style>
      </head>
      <body>
        <button id="printBtn">Imprimir</button>
        <div id="content">${html}</div>
        <script>
          document.getElementById('printBtn').addEventListener('click', function() { window.print(); });
        </script>
      </body>
      </html>`;

      // Define caminho do PDF de saída e retorna imediatamente ao renderer com HTML
      const receiptsDir = path.join(app.getPath('userData'), 'receipts');
      if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
      const filePath = path.join(receiptsDir, `recibo_venda_${venda.id}.pdf`);

      // Abre UMA janela de pré-visualização imediatamente (apenas dentro do app)
      try {
        const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
        const preview = new BrowserWindow({
          width: 520,
          height: 760,
          show: true,
          parent: parent || undefined,
          modal: false,
          title: `Recibo #${venda.id}`,
          webPreferences: { sandbox: true }
        });
        preview.setMenuBarVisibility(false);
        await preview.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlPreview));
        try { preview.focus(); } catch (_) {}
        receiptPreviews.add(preview);
        preview.on('closed', () => { try { receiptPreviews.delete(preview); } catch (_) {} });
      } catch (ePrev) { console.warn('Falha ao abrir preview interno:', ePrev?.message); }

      // Geração do PDF (background) para salvar arquivo
      (async () => {
        try {
          const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
          await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
          try { await new Promise(res => win.webContents.once('did-finish-load', res)); } catch (_) {}
          try { await win.webContents.executeJavaScript('document.fonts ? document.fonts.ready : Promise.resolve()'); } catch (_) {}
          try { await win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)))'); } catch (_) {}
          const pdfBuffer = await win.webContents.printToPDF({
            printBackground: true,
            margins: { marginType: 0 },
            pageSize: { width: pageWidthMicrons, height: pageHeightMicrons },
            landscape: false,
            scale: 1
          });
          try { win.destroy(); } catch (_) {}
          fs.writeFileSync(filePath, pdfBuffer);
        } catch (bgErr) {
          console.warn('Geração de PDF em background falhou:', bgErr?.message);
        }
      })();

      // Preview já foi aberto no main
      return { success: true, path: filePath, openMethod: 'preview-window', html };
    } catch (err) {
      console.error('Erro ao gerar recibo:', err);
      return { success: false, message: err.message };
    }
  });

  // --- Handlers do Dashboard ---
  ipcMain.handle('dashboard:dados', async (event, { startDate, endDate }) => {
    try {


      // 1. Resumo do dia
      const resumoDia = await dbGet(`
        SELECT 
          COUNT(id) as numeroVendas, 
          SUM(total) as faturamentoTotal 
        FROM vendas 
        WHERE DATE(data) BETWEEN ? AND ? AND status = 'concluida'`, [startDate, endDate]);

      // 2. Produtos mais vendidos (Top 5)
      const produtosMaisVendidos = await dbAll(`
        SELECT 
          p.nome, 
          SUM(iv.quantidade) as totalVendido
        FROM itens_venda iv
        JOIN produtos p ON iv.produto_id = p.id
        JOIN vendas v ON iv.venda_id = v.id
        WHERE v.status = 'concluida' AND DATE(v.data) BETWEEN ? AND ?
        GROUP BY p.nome
        ORDER BY totalVendido DESC
        LIMIT 5
      `, [startDate, endDate]);

      // 3. Desempenho de vendas (últimos 7 dias)
      const desempenhoVendas = await dbAll(`
        SELECT 
          strftime('%Y-%m-%d', data) as dia, 
          SUM(total) as faturamento
        FROM vendas
        WHERE DATE(data) BETWEEN ? AND ? AND status = 'concluida'
        GROUP BY dia
        ORDER BY dia ASC
      `, [startDate, endDate]);

      // 4. Métodos de pagamento (normalizado para evitar duplicidade por caixa/espacos)
      const metodosPagamento = await dbAll(`
        SELECT 
          LOWER(TRIM(metodo_pagamento)) AS metodo_pagamento,
          COUNT(id) AS quantidade
        FROM vendas
        WHERE DATE(data) BETWEEN ? AND ? AND status = 'concluida'
        GROUP BY LOWER(TRIM(metodo_pagamento))
      `, [startDate, endDate]);

      return {
        resumoDia: {
          ...resumoDia,
          ticketMedio: resumoDia.numeroVendas > 0 ? resumoDia.faturamentoTotal / resumoDia.numeroVendas : 0
        },
        produtosMaisVendidos,
        desempenhoVendas,
        metodosPagamento
      };
    } catch (error) {
      console.error('Erro ao buscar dados do dashboard:', error);
      throw error; // Propaga o erro para o renderer
    }
  });

  ipcMain.handle('produtos:obterCaminhoImagem', (event, fileName) => {
    if (!fileName) return null;
    return path.join(app.getPath('userData'), 'product-images', fileName);
  });
}

// --- Funções da Aplicação ---
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.maximize();
}

// --- Ciclo de Vida da Aplicação ---
app.whenReady().then(async () => {
  try {
    await initializeDatabase();
    setupIpcHandlers();
    createWindow();

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  } catch (error) {
    console.error('Falha crítica ao inicializar a aplicação:', error);
    dialog.showErrorBox('Erro Crítico', `Não foi possível iniciar a aplicação: ${error.message}. Verifique os logs para mais detalhes.`);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  db.close((err) => {
    if (err) {
      console.error('Erro ao fechar o banco de dados:', err.message);
    }
    console.log('Conexão com o banco de dados fechada.');
  });
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
