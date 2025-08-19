// PDV Profissional - Sistema de Vendas
class PDVSystem {
    constructor() {
        this.products = [];
        this.cart = [];
        this.selectedPaymentMethod = 'dinheiro';
        this.discount = 0;
        this.salesToday = 0;
        this.revenueToday = 0;
        this.isFinancialsVisible = true;
        this.completedSales = [];
        // Campos auxiliares para pagamento em dinheiro (somente UI)
        this.amountReceived = 0;
        this.changeAmount = 0;
    }

    async init() {
        window.addEventListener('focus', async () => {
            await this.reloadAllData();
            try {
                // Se não houver modal aberto, devolve foco ao campo de busca
                const hasOpenModal = ['report-modal','card-type-modal','sale-details-modal']
                    .some(id => {
                        const el = document.getElementById(id);
                        return el && getComputedStyle(el).display !== 'none';
                    });
                if (!hasOpenModal) {
                    const search = document.getElementById('search-product');
                    if (search) {
                        setTimeout(() => {
                            search.focus();
                            try { search.setSelectionRange(search.value.length, search.value.length); } catch (_) {}
                        }, 0);
                    }
                }
            } catch (_) {}
        });

        await this.loadProducts();
        await this.loadSales();
        this.calculateDailyStats();
        this.updateFooterStats();
        this.updateDateTime();
        setInterval(() => this.updateDateTime(), 1000);
        this.setupEventListeners();
        this.setupReceiptModalListeners();
    }

    async reloadAllData() {
        await this.loadProducts();
        await this.loadSales();
        this.calculateDailyStats();
        this.renderProducts();
        this.updateFooterStats();
        this.updatePaymentMethodUI();
        this.renderCart();
        this.updateSummary();
    }

    calculateDailyStats() {
        const localToday = new Date();
        const todayString = `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, '0')}-${String(localToday.getDate()).padStart(2, '0')}`;

        this.salesToday = 0;
        this.revenueToday = 0;

        if (!this.completedSales || this.completedSales.length === 0) {
            return;
        }

        for (const sale of this.completedSales) {
            if (sale.status === 'cancelada') {
                continue; 
            }

            if (!sale.data || isNaN(new Date(sale.data).getTime())) {
                continue;
            }

            const saleLocalDate = new Date(sale.data);
            const saleDateString = `${saleLocalDate.getFullYear()}-${String(saleLocalDate.getMonth() + 1).padStart(2, '0')}-${String(saleLocalDate.getDate()).padStart(2, '0')}`;
            
            if (saleDateString === todayString) {
                this.salesToday++;
                this.revenueToday += sale.total;
            }
        }
    }

    async loadSales() {
        try {
            this.completedSales = await window.electronAPI.vendasListar();
        } catch (error) {
            console.error('FRONTEND: Erro ao carregar vendas:', error);
            this.completedSales = [];
        }
    }

    async loadProducts() {
        try {
            const produtos = await window.electronAPI.produtosListar();
            this.products = produtos.map(produto => ({
                id: produto.id,
                name: produto.nome,
                price: produto.preco,
                stock: produto.estoque,
                image: produto.imagem
            }));
        } catch (error) {
            console.error('Erro ao carregar produtos:', error);
            this.products = [];
        }
    }

    async renderProducts(searchTerm = '') {
        const productsGrid = document.getElementById('products-grid');
        productsGrid.innerHTML = '';
        const filteredProducts = this.products.filter(p =>
            p.name.toLowerCase().includes(searchTerm.toLowerCase()) && p.stock > 0
        );

        if (filteredProducts.length === 0) {
            productsGrid.innerHTML = '<p class="empty-grid-message">Nenhum produto encontrado ou todos estão sem estoque.</p>';
            return;
        }

        for (const product of filteredProducts) {
            const productCard = document.createElement('div');
            productCard.className = 'product-card';

            let imageHtml = '<div class="product-card-placeholder"><i class="fas fa-box"></i></div>';
            if (product.image) {
                try {
                    const imagePath = await window.electronAPI.produtosObterCaminhoImagem(product.image);
                    if (imagePath) {
                        imageHtml = `<img src="file://${imagePath}" alt="${product.name}" class="product-card-image">`;
                    }
                } catch (error) {
                    console.error(`Erro ao carregar imagem para ${product.name}:`, error);
                }
            }

            productCard.innerHTML = `
                <div class="product-card-content">
                    ${imageHtml}
                    <h3>${product.name}</h3>
                    <p>R$ ${product.price.toFixed(2).replace('.', ',')}</p>
                </div>
                <div class="product-card-overlay">
                    <button class="btn-add-cart">Adicionar</button>
                </div>
            `;

            productCard.addEventListener('click', (e) => {
                if (e.target.classList.contains('btn-add-cart')) {
                    e.stopPropagation();
                }
                this.addToCart(product);
            });
            productsGrid.appendChild(productCard);
        }
    }

    addToCart(product) {
        if (product.stock <= 0) {
            alert('Produto esgotado!');
            return;
        }

        const existingItem = this.cart.find(item => item.id === product.id);
        if (existingItem) {
            const productInCatalog = this.products.find(p => p.id === existingItem.id);
            if (existingItem.quantity < productInCatalog.stock) {
                existingItem.quantity++;
            } else {
                alert(`Estoque máximo para ${productInCatalog.name} atingido!`);
            }
        } else {
            this.cart.push({ ...product, quantity: 1 });
        }
        this.renderCart();
        this.updateSummary();
    }

    removeFromCart(productId) {
        this.cart = this.cart.filter(item => item.id !== productId);
        this.renderCart();
        this.updateSummary();
    }

    updateQuantity(productId, newQuantity) {
        const item = this.cart.find(item => item.id === productId);
        if (!item) return;

        const product = this.products.find(p => p.id === productId);
        if (newQuantity > product.stock) {
            alert(`Estoque insuficiente. Apenas ${product.stock} unidades de ${product.name} disponíveis.`);
            newQuantity = product.stock;
        }

        if (newQuantity <= 0) {
            this.removeFromCart(productId);
        } else {
            item.quantity = newQuantity;
        }
        this.renderCart();
        this.updateSummary();
    }

    renderCart() {
        const cartContent = document.getElementById('cart-content');
        if (this.cart.length === 0) {
            cartContent.innerHTML = '<div class="empty-cart"><p>Carrinho vazio</p></div>';
            this.updateSummary();
            return;
        }

        cartContent.innerHTML = this.cart.map(item => {
            const productInCatalog = this.products.find(p => p.id === item.id) || { stock: 0 };
            return `
            <div class="cart-item">
                <div class="cart-item-header">
                    <span class="cart-item-name">${item.name}</span>
                    <button class="cart-item-remove" onclick="pdv.removeFromCart(${item.id})"><i class="fas fa-times"></i></button>
                </div>
                <div class="cart-item-details">
                    <div class="cart-item-quantity-controls">
                        <button onclick="pdv.updateQuantity(${item.id}, ${item.quantity - 1})">-</button>
                        <input type="number" value="${item.quantity}" onchange="pdv.updateQuantity(${item.id}, parseInt(this.value))" min="1" max="${productInCatalog.stock}">
                        <button onclick="pdv.updateQuantity(${item.id}, ${item.quantity + 1})">+</button>
                    </div>
                    <span class="cart-item-price">R$ ${(item.price * item.quantity).toFixed(2).replace('.', ',')}</span>
                </div>
            </div>
        `}).join('');
    }

    updateSummary() {
        const subtotal = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const discountAmount = subtotal * (this.discount / 100);
        const total = subtotal - discountAmount;
        
        document.getElementById('subtotal').textContent = `R$ ${subtotal.toFixed(2).replace('.', ',')}`;
        document.getElementById('total').textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;
    }

    clearCart() {
        this.cart = [];
        this.renderCart();
        this.updateSummary();
    }

    // --- Pré-visualização do Recibo no Renderer ---
    setupReceiptModalListeners() {
        try {
            const closeBtn = document.getElementById('receipt-close');
            const backdrop = document.getElementById('receipt-backdrop');
            const printBtn = document.getElementById('receipt-print');
            closeBtn && closeBtn.addEventListener('click', () => this.closeReceiptModal());
            backdrop && backdrop.addEventListener('click', () => this.closeReceiptModal());
            printBtn && printBtn.addEventListener('click', () => this.printReceiptModal());
        } catch (_) {}
    }

    openReceiptModal({ html = '', path = '' } = {}) {
        const modal = document.getElementById('receipt-modal');
        const body = document.getElementById('receipt-body');
        if (!modal || !body) return;
        // Constrói iframe com srcdoc quando houver HTML; caso contrário, aponta para o arquivo PDF
        let iframeHtml = '';
        if (html && typeof html === 'string') {
            iframeHtml = `<iframe id="receipt-iframe" srcdoc="${html.replace(/"/g, '&quot;')}"></iframe>`;
        } else if (path) {
            const fileUrl = 'file:///' + String(path).replace(/\\/g, '/');
            iframeHtml = `<iframe id="receipt-iframe" src="${encodeURI(fileUrl)}"></iframe>`;
        }
        body.innerHTML = iframeHtml || '<div style="padding:16px; font-weight:600">Recibo gerado, mas não foi possível exibir o conteúdo.</div>';
        modal.style.display = 'flex';
        modal.style.pointerEvents = 'auto';
        modal.style.visibility = 'visible';
        modal.classList.add('show');
        modal.removeAttribute('aria-hidden');
        try { modal.focus(); } catch (_) {}
    }

    closeReceiptModal() {
        const modal = document.getElementById('receipt-modal');
        if (!modal) return;
        modal.style.display = 'none';
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden','true');
        modal.style.pointerEvents = 'none';
        modal.style.visibility = 'hidden';
        const search = document.getElementById('search-product');
        if (search) setTimeout(() => { search.focus(); try { search.setSelectionRange(search.value.length, search.value.length); } catch (_) {} }, 0);
    }

    printReceiptModal() {
        const iframe = document.getElementById('receipt-iframe');
        if (iframe && iframe.contentWindow) {
            try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) { console.warn('Falha ao imprimir recibo:', e); }
        }
    }

    // --- Modal de Pagamento ---
    openPaymentModal() {
        if (this.cart.length === 0) {
            alert('O carrinho está vazio.');
            return;
        }
        // Se a forma atual NÃO é dinheiro, finaliza direto (cartão/pix não precisam de troco)
        const current = String(this.selectedPaymentMethod || '').toLowerCase();
        if (current !== 'dinheiro') {
            this.finalizeSale();
            return;
        }
        const modal = document.getElementById('payment-modal');
        // Fallback: se o modal não existir (HTML antigo), finalize direto para não travar o fluxo
        if (!modal) {
            this.finalizeSale();
            return;
        }
        const backdrop = document.getElementById('payment-backdrop');
        const cancelBtn = document.getElementById('payment-cancel');
        const confirmBtn = document.getElementById('payment-confirm');
        const radios = Array.from(document.querySelectorAll('input[name="payment-method-radio"]'));
        const dinheiroExtra = document.getElementById('dinheiro-extra');
        const amountInput = document.getElementById('amount-received-input');
        const totalEl = document.getElementById('payment-total-amount');
        const changeEl = document.getElementById('payment-change-amount');

        // Atualiza total do modal
        const subtotal = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const discountAmount = subtotal * (this.discount / 100);
        const total = subtotal - discountAmount;
        totalEl.textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;
        changeEl.textContent = 'R$ 0,00';
        amountInput.value = '';
        this.amountReceived = 0;
        this.changeAmount = 0;

        // Estado inicial: dinheiro selecionado
        radios.forEach(r => { r.checked = (r.value.toLowerCase() === 'dinheiro'); });
        dinheiroExtra.style.display = 'block';

        const onRadioChange = () => {
            const selected = radios.find(r => r.checked)?.value || 'dinheiro';
            if (selected.toLowerCase().startsWith('cartão') || selected.toLowerCase() === 'pix' || selected.toLowerCase() === 'cancelada') {
                dinheiroExtra.style.display = 'none';
            } else {
                dinheiroExtra.style.display = 'block';
            }
        };
        radios.forEach(r => r.addEventListener('change', onRadioChange, { once: false }));

        const recalcChange = () => {
            const val = parseFloat(String(amountInput.value).replace(',', '.')) || 0;
            this.amountReceived = val;
            const diff = val - total;
            this.changeAmount = diff > 0 ? diff : 0;
            changeEl.textContent = `R$ ${this.changeAmount.toFixed(2).replace('.', ',')}`;
        };
        amountInput.addEventListener('input', recalcChange);

        const close = () => {
            modal.style.display = 'none';
            modal.style.pointerEvents = 'none';
            modal.style.visibility = 'hidden';
            modal.setAttribute('aria-hidden','true');
            // Remove handlers que usamos
            backdrop.removeEventListener('click', close);
            cancelBtn.removeEventListener('click', close);
            confirmBtn.removeEventListener('click', onConfirm);
            amountInput.removeEventListener('input', recalcChange);
            radios.forEach(r => r.removeEventListener('change', onRadioChange));
            // devolve foco ao campo de busca
            const search = document.getElementById('search-product');
            if (search) setTimeout(() => { search.focus(); try { search.setSelectionRange(search.value.length, search.value.length); } catch (_) {} }, 0);
        };

        const onConfirm = async () => {
            const selected = radios.find(r => r.checked)?.value || 'dinheiro';
            if (selected === 'cancelada') {
                const ok = confirm('Cancelar a finalização? A venda NÃO será registrada.');
                if (ok) close();
                return;
            }
            if (selected.toLowerCase() === 'dinheiro') {
                if (this.amountReceived < total) {
                    alert('Valor recebido menor que o total.');
                    return;
                }
                this.selectedPaymentMethod = 'dinheiro';
            } else if (selected === 'Cartão (Débito)') {
                this.selectedPaymentMethod = 'Cartão (Débito)';
            } else if (selected === 'Cartão (Crédito)') {
                this.selectedPaymentMethod = 'Cartão (Crédito)';
            } else if (selected.toLowerCase() === 'pix') {
                this.selectedPaymentMethod = 'pix';
            }
            this.updatePaymentMethodUI();
            close();
            await this.finalizeSale();
        };

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', close);
        backdrop.addEventListener('click', close);

        modal.hidden = false;
        modal.removeAttribute('aria-hidden');
        modal.style.display = 'flex';
        modal.style.pointerEvents = 'auto';
        modal.style.visibility = 'visible';
        try { amountInput.focus(); } catch (_) {}
    }

    async finalizeSale() {
        if (this.cart.length === 0) {
            alert('O carrinho está vazio.');
            return;
        }

        // Fecha quaisquer overlays que possam estar abertos e bloqueando interação
        const overlaysToClose = ['report-modal', 'card-type-modal', 'sale-details-modal'];
        overlaysToClose.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.style.display = 'none';
                el.style.pointerEvents = 'none';
                el.hidden = true;
                el.setAttribute('aria-hidden', 'true');
            }
        });

        const subtotal = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const discountAmount = subtotal * (this.discount / 100);
        const total = subtotal - discountAmount;

        const vendaData = {
            data: new Date().toISOString(),
            total: total,
            itens: this.cart.map(item => ({ 
                id: item.id, 
                name: item.name, // Adicionado para enviar o nome do produto
                quantidade: item.quantity, 
                price: item.price
            })),
            metodoPagamento: this.selectedPaymentMethod
        };

        try {
            const result = await window.electronAPI.vendasRegistrar(vendaData);
            if (result.success) {
                // Evita alert() que pode causar perda de foco no Electron
                try {
                    window.electronAPI.showNotification('Venda concluída', `Venda #${result.vendaId} registrada com sucesso!`);
                } catch (_) {
                    // Fallback silencioso se notificação não estiver disponível
                    console.log(`Venda #${result.vendaId} registrada com sucesso!`);
                }
                // Limpa carrinho e recarrega imediatamente para não travar o fluxo
                this.clearCart();
                await this.reloadAllData();
                // Gera e abre o recibo automaticamente, sem perguntar
                try {
                    try { window.electronAPI.showNotification('Gerando recibo...', `Venda #${result.vendaId}`); } catch (_) {}
                    if (!window.electronAPI || typeof window.electronAPI.reciboGerar !== 'function') {
                        alert('Recibo: API indisponível (preload)');
                    } else {
                        const r = await window.electronAPI.reciboGerar(result.vendaId, { largura: '58' });
                        try { console.log('Resposta recibo:', r); } catch (_) {}
                        if (!r || !r.success) {
                            console.warn('Falha ao gerar recibo:', r && r.message);
                            try { window.electronAPI.showNotification('Recibo não gerado', r && r.message ? String(r.message) : 'Verifique os logs.'); } catch (_) {}
                            try { alert('Falha ao gerar recibo: ' + (r && r.message ? String(r.message) : 'verifique os logs.')); } catch (_) {}
                        } else {
                            if (r.path) {
                                try { window.electronAPI.showNotification('Recibo salvo', r.path); } catch (_) { console.log('Recibo salvo em:', r.path); }
                            }
                            // Abre apenas o modal interno com o HTML retornado (ou PDF via iframe)
                            try { this.openReceiptModal({ html: (r && r.html) || '', path: (r && r.path) || '' }); } catch (eModal) { console.warn('Falha ao abrir modal de recibo:', eModal); }
                            // Evita abrir pop-ups/alerts; apenas loga método/erros
                            if (r.openError) { console.warn('Abertura automática falhou:', r.openError); }
                            if (r.openMethod) { console.log('Abertura de recibo:', r.openMethod); }
                        }
                    }
                } catch (e) { console.warn('Recibo: chamada não disponível/erro', e); try { alert('Erro ao iniciar/aguardar recibo: ' + (e && e.message ? e.message : String(e))); } catch (_) {} }
                // Workaround de foco após alert/IPC: garante que o input de busca volte a aceitar digitação
                try {
                    window.focus();
                } catch (_) {}
                const search = document.getElementById('search-product');
                if (search) {
                    // Pequena sequência para garantir caret visível mesmo em Electron
                    requestAnimationFrame(() => {
                        if (document.activeElement && typeof document.activeElement.blur === 'function') {
                            document.activeElement.blur();
                        }
                        // eslint-disable-next-line no-unused-expressions
                        void document.body.offsetWidth;
                        search.focus();
                        // Algumas plataformas precisam do select para mostrar o caret
                        try { search.setSelectionRange(search.value.length, search.value.length); } catch (_) {}
                    });
                }
            } else {
                alert(`Falha ao registrar a venda: ${result.message}`);
            }
        } catch (error) {
            console.error('Erro ao finalizar a venda:', error);
            alert('Ocorreu um erro grave ao tentar finalizar a venda.');
        }
    }

    setupEventListeners() {
        const searchInput = document.getElementById('search-product');
        searchInput.addEventListener('input', () => {
            this.renderProducts(searchInput.value);
        });

        // Suporte ao leitor de código de barras (Enter para buscar)
        searchInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const barcode = searchInput.value.trim();
                if (barcode) {
                    try {
                        const product = await window.electronAPI.produtosBuscarPorCodigoBarras(barcode);
                        if (product) {
                            this.addToCart(product);
                            searchInput.value = ''; 
                            this.renderProducts(); 
                        } else {
                            window.electronAPI.showNotification('Erro', 'Produto com este código de barras não encontrado.');
                            searchInput.value = '';
                        }
                    } catch (error) {
                        console.error('Erro ao buscar produto por código de barras:', error);
                        alert('Ocorreu um erro ao buscar o produto.');
                    }
                }
            }
        });

        const paymentBtns = document.querySelectorAll('.payment-btn');
        const cardTypeModal = document.getElementById('card-type-modal');
        const closeModalBtn = document.getElementById('close-modal-btn');
        const debitBtn = document.getElementById('debit-btn');
        const creditBtn = document.getElementById('credit-btn');

        const showCardModal = () => {
            cardTypeModal.hidden = false;
            cardTypeModal.removeAttribute('aria-hidden');
            cardTypeModal.style.display = 'flex';
            cardTypeModal.style.pointerEvents = 'auto';
            cardTypeModal.style.visibility = 'visible';
        };
        const hideCardModal = () => {
            cardTypeModal.style.display = 'none';
            cardTypeModal.style.pointerEvents = 'none';
            cardTypeModal.style.visibility = 'hidden';
            cardTypeModal.hidden = true;
            cardTypeModal.setAttribute('aria-hidden','true');
        };

        paymentBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const method = e.currentTarget.dataset.method;
                if (method === 'cartao') {
                    showCardModal();
                } else {
                    this.selectedPaymentMethod = method;
                    this.updatePaymentMethodUI();
                }
            });
        });
        
        debitBtn.addEventListener('click', () => { this.selectedPaymentMethod = 'Cartão (Débito)'; this.updatePaymentMethodUI(); hideCardModal(); });
        creditBtn.addEventListener('click', () => { this.selectedPaymentMethod = 'Cartão (Crédito)'; this.updatePaymentMethodUI(); hideCardModal(); });
        closeModalBtn.addEventListener('click', hideCardModal);
        cardTypeModal.addEventListener('click', (e) => { if (e.target === cardTypeModal) hideCardModal(); });

        document.getElementById('discount').addEventListener('input', (e) => { this.discount = parseFloat(e.target.value) || 0; this.updateSummary(); });
        document.getElementById('btn-clear').addEventListener('click', () => {
            if (confirm('Limpar carrinho?')) {
                this.clearCart();
                // Após limpar, devolve foco ao campo de busca
                const search = document.getElementById('search-product');
                if (search) {
                    setTimeout(() => { search.focus(); try { search.setSelectionRange(search.value.length, search.value.length); } catch (_) {} }, 0);
                }
            }
        });
        document.getElementById('btn-finalize').addEventListener('click', () => this.openPaymentModal());
        
        document.querySelector('.btn-report').addEventListener('click', () => this.openReportModal());
        document.getElementById('close-report-modal-btn').addEventListener('click', () => this.closeReportModal());
        document.getElementById('close-details-modal-btn').addEventListener('click', () => this.closeSaleDetailsModal());

        // Permitir fechar o modal de relatório clicando fora do conteúdo
        const reportModalOverlay = document.getElementById('report-modal');
        if (reportModalOverlay) {
            reportModalOverlay.addEventListener('click', (e) => {
                if (e.target === reportModalOverlay) {
                    this.closeReportModal();
                }
            });
        }

        document.getElementById('report-date-start').addEventListener('change', () => this.renderReport());
        document.getElementById('report-date-end').addEventListener('change', () => this.renderReport());
        
        document.querySelectorAll('.payment-filter-buttons .btn-filter').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelector('.payment-filter-buttons .active').classList.remove('active');
                e.currentTarget.classList.add('active');
                this.renderReport();
            });
        });

        document.getElementById('toggle-visibility-btn').addEventListener('click', () => this.toggleFinancialsVisibility());
        document.getElementById('btn-gerenciar-produtos').addEventListener('click', () => { window.location.href = 'produtos.html'; });

        document.getElementById('btn-clear-history').addEventListener('click', async () => {
            const userConfirmed = confirm('Tem certeza de que deseja apagar TODO o histórico de vendas? Esta ação não pode ser desfeita.');
            if (userConfirmed) {
                try {
                    const result = await window.electronAPI.vendasLimparHistorico();
                    if (result.success) {
                        alert('Histórico de vendas limpo com sucesso!');
                        await this.reloadAllData();
                        this.renderReport();
                    } else {
                        alert(`Erro ao limpar o histórico: ${result.message}`);
                    }
                } catch (error) {
                    console.error('Erro crítico ao limpar histórico:', error);
                    alert('Ocorreu um erro inesperado. Verifique o console.');
                }
            }
        });

        // Limpar somente selecionados no relatório
        const btnClearSelected = document.getElementById('btn-clear-selected');
        if (btnClearSelected) {
            btnClearSelected.addEventListener('click', async () => {
                const checked = Array.from(document.querySelectorAll('#report-sales-list .select-sale:checked'));
                if (checked.length === 0) {
                    alert('Selecione ao menos uma venda para cancelar.');
                    return;
                }
                const ids = checked.map(chk => parseInt(chk.dataset.saleId, 10)).filter(n => !isNaN(n));
                try {
                    // Fecha o relatório antes de iniciar operações assíncronas
                    this.closeReportModal();
                    for (const id of ids) {
                        await window.electronAPI.vendaCancelar(id);
                    }
                    await this.reloadAllData();
                    try { window.electronAPI.showNotification('Vendas canceladas', `${ids.length} venda(s) foram canceladas.`); } catch (_) {}
                    // Garante foco após recarregar
                    const search = document.getElementById('search-product');
                    if (search) setTimeout(() => { search.focus(); try { search.setSelectionRange(search.value.length, search.value.length); } catch (_) {} }, 0);
                } catch (err) {
                    console.error('Erro ao cancelar vendas selecionadas:', err);
                    alert('Falha ao cancelar uma ou mais vendas selecionadas.');
                }
            });
        }

        // Fail-safe: garante que nenhum overlay oculto bloqueie cliques
        document.addEventListener('mouseup', (ev) => {
            try {
                const overlays = Array.from(document.querySelectorAll('.modal-overlay'));
                const anyOpen = overlays.some(el => getComputedStyle(el).display !== 'none');
                if (!anyOpen) {
                    overlays.forEach(el => {
                        el.style.display = 'none';
                        el.style.pointerEvents = 'none';
                        el.hidden = true;
                        el.setAttribute('aria-hidden','true');
                    });
                }
                if ((ev.target instanceof HTMLElement) && ev.target.id === 'search-product') {
                    const input = ev.target;
                    setTimeout(() => {
                        input.focus({ preventScroll: true });
                        try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
                    }, 0);
                }
            } catch (_) {}
        }, true);
    }
    
    updatePaymentMethodUI() {
        const paymentBtns = document.querySelectorAll('.payment-btn');
        paymentBtns.forEach(btn => {
            const baseMethod = btn.dataset.method;
            const selectedBaseMethod = this.selectedPaymentMethod.split(' ')[0].toLowerCase().replace('ç', 'c').replace('ã', 'a');

            btn.classList.remove('active');
            if (baseMethod === selectedBaseMethod) {
                btn.classList.add('active');
                if (baseMethod === 'cartao' && this.selectedPaymentMethod.includes('(')) {
                    btn.querySelector('span').textContent = this.selectedPaymentMethod;
                } else if (baseMethod === 'cartao') {
                    btn.querySelector('span').textContent = 'Cartão';
                }
            } else {
                if (baseMethod === 'cartao') {
                    btn.querySelector('span').textContent = 'Cartão';
                }
            }
        });
    }

    updateDateTime() {
        const now = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
        document.querySelector('.date-time').textContent = now.toLocaleString('pt-BR', options);
    }
    
    updateFooterStats() {
        const salesTodayEl = document.getElementById('sales-today');
        const revenueTodayEl = document.getElementById('revenue-today');

        if (this.isFinancialsVisible) {
            salesTodayEl.textContent = this.salesToday;
            revenueTodayEl.textContent = `R$ ${this.revenueToday.toFixed(2).replace('.', ',')}`;
        } else {
            salesTodayEl.textContent = '***';
            revenueTodayEl.textContent = 'R$ ****,**';
        }
    }

    toggleFinancialsVisibility() {
        this.isFinancialsVisible = !this.isFinancialsVisible;
        this.updateFooterStats();
        const icon = document.querySelector('#toggle-visibility-btn i');
        icon.className = this.isFinancialsVisible ? 'fas fa-eye' : 'fas fa-eye-slash';
    }
    
    openReportModal() {
        const reportModal = document.getElementById('report-modal');
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        document.getElementById('report-date-start').valueAsDate = firstDayOfMonth;
        document.getElementById('report-date-end').valueAsDate = today;
        reportModal.hidden = false;
        reportModal.removeAttribute('aria-hidden');
        reportModal.style.display = 'flex';
        reportModal.style.pointerEvents = 'auto';
        reportModal.style.visibility = 'visible';
        this.renderReport();
    }

    closeReportModal() {
        const modal = document.getElementById('report-modal');
        modal.style.display = 'none';
        // Garante que nenhum overlay transparente bloqueie cliques/teclas
        modal.style.pointerEvents = 'none';
        // Sinaliza acessibilidade e retira da árvore
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        // Tira qualquer foco residual
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }
        // Fecha qualquer outro overlay por segurança
        document.querySelectorAll('.modal-overlay').forEach(el => {
            el.style.display = 'none';
            el.style.pointerEvents = 'none';
            el.hidden = true;
            el.setAttribute('aria-hidden','true');
        });
        // Força repaint/reflow para evitar bug gráfico que prende interação até alternar janela
        // eslint-disable-next-line no-unused-expressions
        void document.body.offsetWidth;
        // Devolve o foco para o campo de busca, garantindo que o usuário possa digitar
        const search = document.getElementById('search-product');
        if (search) {
            // Duplo RAF para garantir aplicação do estilo e render antes do foco
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    // Toggle rápido para garantir reflow no input e caret visível
                    const prevDisplay = search.style.display;
                    search.style.display = 'inline-block';
                    // eslint-disable-next-line no-unused-expressions
                    void search.offsetHeight;
                    search.style.display = prevDisplay;
                    // Traz janela ao topo
                    try { window.focus(); } catch (_) {}
                    search.focus();
                    try { search.setSelectionRange(search.value.length, search.value.length); } catch (_) {}
                    // Dispara evento de focus manual
                    try { search.dispatchEvent(new Event('focus', { bubbles: true })); } catch (_) {}
                    // Ajudinha para Chromium/Electron exibir caret
                    let addedTabindex = false;
                    if (!search.hasAttribute('tabindex')) { search.setAttribute('tabindex', '0'); addedTabindex = true; }
                    // Força troca de foco
                    try { search.blur(); } catch (_) {}
                    try { search.focus({ preventScroll: true }); } catch (_) { search.focus(); }
                    if (addedTabindex) { setTimeout(() => { try { search.removeAttribute('tabindex'); } catch (_) {} }, 0); }
                });
            });
        }
    }

    renderReport() {
        const dateStartFilter = document.getElementById('report-date-start').value;
        const dateEndFilter = document.getElementById('report-date-end').value;
        const paymentMethodFilter = document.querySelector('.payment-filter-buttons .active').dataset.filter;

        let dateFilteredSales = this.completedSales.filter(sale => {
            if (!sale.data || isNaN(new Date(sale.data).getTime())) return false;
            const saleLocalDate = new Date(sale.data);
            const saleDateString = `${saleLocalDate.getFullYear()}-${String(saleLocalDate.getMonth() + 1).padStart(2, '0')}-${String(saleLocalDate.getDate()).padStart(2, '0')}`;
            
            let dateMatch = true;
            if (dateStartFilter && saleDateString < dateStartFilter) dateMatch = false;
            if (dateEndFilter && saleDateString > dateEndFilter) dateMatch = false;
            return dateMatch;
        });

        // Normalização robusta do método de pagamento (ex.: 'Cartão (Crédito)' -> 'credito')
        const normalizeMethod = (m) => {
            if (m == null) return '';
            let s = String(m).toLowerCase();
            // remove acentos
            try { s = s.normalize('NFD').replace(/\p{Diacritic}+/gu, ''); } catch (_) { s = s.replace('ç','c').replace('ã','a').replace('á','a').replace('é','e').replace('í','i').replace('ó','o').replace('ú','u'); }
            s = s.trim();
            // mapeamentos usuais
            if (s.includes('cartao') && s.includes('credito')) return 'credito';
            if (s.includes('cartao') && s.includes('debito')) return 'debito';
            if (s.includes('credito')) return 'credito';
            if (s.includes('debito')) return 'debito';
            if (s.includes('pix')) return 'pix';
            if (s.includes('dinheiro')) return 'dinheiro';
            return s;
        };

        let finalFilteredSales;
        if (paymentMethodFilter === 'cancelada') {
            finalFilteredSales = dateFilteredSales.filter(sale => sale.status === 'cancelada');
        } else if (paymentMethodFilter !== 'todos') {
            finalFilteredSales = dateFilteredSales.filter(sale => {
                const rawMethod = sale.metodo_pagamento ?? sale.metodoPagamento ?? '';
                const norm = normalizeMethod(rawMethod);
                return norm === paymentMethodFilter && sale.status !== 'cancelada';
            });
        } else { // 'todos'
            finalFilteredSales = dateFilteredSales.filter(sale => sale.status !== 'cancelada');
        }

        const totalRevenue = paymentMethodFilter === 'cancelada' 
            ? 0 
            : finalFilteredSales.reduce((acc, sale) => acc + sale.total, 0);

        const reportSalesList = document.getElementById('report-sales-list');
        reportSalesList.innerHTML = '';

        if (finalFilteredSales.length === 0) {
            reportSalesList.innerHTML = '<p class="empty-report">Nenhuma venda encontrada para os filtros selecionados.</p>';
        } else {
            finalFilteredSales.forEach(sale => {
                const saleDate = new Date(sale.data).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
                const itemsCount = sale.itens ? sale.itens.reduce((acc, item) => acc + item.quantidade, 0) : 0;
    
                const saleElement = document.createElement('div');
                saleElement.className = 'report-sale-item';
    
                saleElement.innerHTML = `
                    <span class="report-select">${sale.status !== 'cancelada' ? `<input type="checkbox" class="select-sale" data-sale-id="${sale.id}">` : ''}</span>
                    <span class="report-id">${sale.id}</span>
                    <span class="report-date">${saleDate}</span>
                    <span class="report-items">${itemsCount}</span>
                    <span class="report-total">R$ ${sale.total.toFixed(2).replace('.', ',')}</span>
                    <span class="report-actions">
                        <button class="btn-details" data-sale-id="${sale.id}">Ver Detalhes</button>
                        ${(sale.status !== 'cancelada') ? `<button class="btn-receipt" data-sale-id="${sale.id}">Recibo</button>` : ''}
                        ${(sale.status !== 'cancelada') ? `<button class="btn-cancel" data-sale-id="${sale.id}">Cancelar</button>` : '<span class="cancelled-tag">Cancelada</span>'}
                    </span>
                `;
                reportSalesList.appendChild(saleElement);
            });
        }

        document.getElementById('report-total-sales').textContent = finalFilteredSales.length;
        document.getElementById('report-total-revenue').textContent = `R$ ${totalRevenue.toFixed(2).replace('.', ',')}`;

        document.querySelectorAll('.btn-details').forEach(button => {
            button.addEventListener('click', (e) => {
                const saleId = parseInt(e.target.dataset.saleId, 10);
                this.openSaleDetailsModal(saleId);
            });
        });

        document.querySelectorAll('.btn-cancel').forEach(button => {
            button.addEventListener('click', (e) => {
                const saleId = parseInt(e.target.dataset.saleId, 10);
                this.cancelSale(saleId);
            });
        });

        // Abrir/Imprimir Recibo de uma venda pelo relatório
        document.querySelectorAll('.btn-receipt').forEach(button => {
            button.addEventListener('click', async (e) => {
                const saleId = parseInt(e.target.dataset.saleId, 10);
                try {
                    try { window.electronAPI.showNotification('Gerando recibo...', `Venda #${saleId}`); } catch (_) {}
                    const r = await window.electronAPI.reciboGerar(saleId, { largura: '58' });
                    if (r && r.path) { try { window.electronAPI.showNotification('Recibo salvo', r.path); } catch (_) {} }
                } catch (err) {
                    console.warn('Erro ao reabrir recibo:', err);
                    try { alert('Erro ao abrir recibo da venda #' + saleId + ': ' + (err && err.message ? err.message : String(err))); } catch (_) {}
                }
            });
        });
    }

    openSaleDetailsModal(saleId) {
        const sale = this.completedSales.find(s => s.id === saleId);
        if (!sale) return;

        const modal = document.getElementById('sale-details-modal');
        const modalBody = document.getElementById('sale-details-body');
        const saleIdSpan = document.getElementById('details-sale-id');

        saleIdSpan.textContent = `#${sale.id}`;

        let itemsHtml = '<ul class="sale-details-list">';
        if (sale.itens && sale.itens.length > 0) {
            sale.itens.forEach(item => {
                const precoFormatado = (item.preco_unitario !== null && item.preco_unitario !== undefined) 
                    ? `R$ ${item.preco_unitario.toFixed(2).replace('.', ',')}` 
                    : 'R$ --';
                itemsHtml += `
                    <li>
                        <span class="item-name">${item.nome}</span>
                        <span class="item-qty">Qtd: ${item.quantidade}</span>
                        <span class="item-price">${precoFormatado}</span>
                    </li>
                `;
            });
        } else {
            itemsHtml += '<li>Não foi possível carregar os detalhes dos itens.</li>';
        }
        itemsHtml += '</ul>';

        const paymentMethod = sale.metodo_pagamento || 'Não informado';
        const total = sale.total ? `R$ ${sale.total.toFixed(2).replace('.', ',')}` : 'R$ --';

        const summaryHtml = `
            <div class="sale-details-summary">
                <p><strong>Total da Venda:</strong> <span>${total}</span></p>
                <p><strong>Forma de Pagamento:</strong> <span>${paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1)}</span></p>
            </div>
        `;

        modalBody.innerHTML = itemsHtml + summaryHtml;
        modal.hidden = false;
        modal.removeAttribute('aria-hidden');
        modal.style.display = 'flex';
        modal.style.pointerEvents = 'auto';
        modal.style.visibility = 'visible';
    }

    closeSaleDetailsModal() {
        const modal = document.getElementById('sale-details-modal');
        modal.style.display = 'none';
        modal.style.pointerEvents = 'none';
        modal.style.visibility = 'hidden';
        modal.hidden = true;
        modal.setAttribute('aria-hidden','true');
        // Refocus search to avoid caret freeze
        const search = document.getElementById('search-product');
        if (search) setTimeout(() => { search.focus(); try { search.setSelectionRange(search.value.length, search.value.length); } catch (_) {} }, 0);
    }

    async cancelSale(saleId) {
        try {
            // Fecha antes de iniciar para não deixar overlay ativo durante await
            this.closeReportModal();
            await window.electronAPI.vendaCancelar(saleId);
            await this.reloadAllData();
            try { window.electronAPI.showNotification('Venda cancelada', `Venda #${saleId} foi cancelada.`); } catch (_) {}
            // Garante foco após recarregar
            const search = document.getElementById('search-product');
            if (search) setTimeout(() => { search.focus(); try { search.setSelectionRange(search.value.length, search.value.length); } catch (_) {} }, 0);
        } catch (error) {
            console.error('Erro ao cancelar venda:', error);
            alert('Ocorreu um erro ao tentar cancelar a venda.');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const pdv = new PDVSystem();
    window.pdv = pdv;
    pdv.init();
});
