// Gerenciador de Produtos - PDV Profissional
class ProductManager {
    constructor() {
        this.produtos = [];
        this.filteredProdutos = [];
        this.editingProductId = null;
        this.currentImageData = null;
        this.currentImageFileName = null;
        this.categorias = [];
        this.currentCategoryFilter = 'all';
        this.currentSearchTerm = '';
    }

    async init() {
        await this.loadCategories();
        await this.loadProducts();
        this.setupEventListeners();
        this.renderCategories();
        this.renderProducts();
        this.updateProductCount();
    }

    async loadProducts() {
        try {
            this.produtos = await window.electronAPI.produtosListar();
            this.filteredProdutos = [...this.produtos];
        } catch (error) {
            console.error('Erro ao carregar produtos:', error);
            this.showMessage('Erro ao carregar produtos do banco de dados', 'error');
        }
    }

    async loadCategories() {
        try {
            this.categorias = await window.electronAPI.categoriasListar();
        } catch (error) {
            console.error('Erro ao carregar categorias:', error);
            this.showMessage('Erro ao carregar categorias', 'error');
        }
    }

    renderCategories() {
        const formSelect = document.getElementById('categoria-produto');
        const filterSelect = document.getElementById('category-filter');

        // Limpa as opções existentes, mantendo a primeira
        formSelect.innerHTML = '<option value="">Nenhuma</option>';
        filterSelect.innerHTML = '<option value="all">Todas</option>';

        this.categorias.forEach(cat => {
            // Adiciona ao dropdown do formulário
            const formOption = document.createElement('option');
            formOption.value = cat.id;
            formOption.textContent = cat.nome;
            formSelect.appendChild(formOption);

            // Adiciona ao dropdown do filtro
            const filterOption = document.createElement('option');
            filterOption.value = cat.id;
            filterOption.textContent = cat.nome;
            filterSelect.appendChild(filterOption);
        });
    }

    setupEventListeners() {
        // Form submission
        document.getElementById('form-produto').addEventListener('submit', (e) => this.handleFormSubmit(e));
        
        // Cancel button
        document.getElementById('btn-cancel').addEventListener('click', () => this.cancelEdit());
        
        // Search functionality
        document.getElementById('search-products').addEventListener('input', (e) => {
            this.currentSearchTerm = e.target.value.toLowerCase();
            this.applyFilters();
        });

        document.getElementById('category-filter').addEventListener('change', (e) => {
            this.currentCategoryFilter = e.target.value;
            this.applyFilters();
        });

        // Navegação para voltar ao PDV
        const btnVoltarPdv = document.getElementById('btn-voltar-pdv');
        if (btnVoltarPdv) {
            btnVoltarPdv.addEventListener('click', () => {
                window.location.href = 'index.html';
            });
        }
        
        // Image upload handling
        const imageInput = document.getElementById('imagem-produto');
        const imagePreview = document.getElementById('image-preview');
        
        if (imageInput && imagePreview) {
            imageInput.addEventListener('change', (e) => this.handleImageUpload(e));
            imagePreview.addEventListener('click', () => {
                if (!imagePreview.classList.contains('has-image')) {
                    imageInput.click();
                }
            });
        }

        document.getElementById('btn-nova-categoria').addEventListener('click', () => this.handleNewCategory());
    }

    async handleFormSubmit(e) {
        e.preventDefault();
        
        const nome = document.getElementById('nome-produto').value.trim();
        const preco = parseFloat(document.getElementById('preco-produto').value);
        const estoque = parseInt(document.getElementById('estoque-produto').value);
        const codigo_barras = document.getElementById('codigo-barras-produto').value.trim();
        const categoria_id = document.getElementById('categoria-produto').value;
        
        // Processar imagem se houver
        let imagemFileName = null;
        if (this.currentImageData && this.currentImageFileName) {
            try {
                imagemFileName = await window.electronAPI.produtosSalvarImagem(this.currentImageData, this.currentImageFileName);
            } catch (error) {
                console.error('Erro ao salvar imagem:', error);
                this.showMessage('Erro ao salvar imagem', 'error');
                return;
            }
        }
        
        // Validations
        if (!nome) {
            this.showMessage('Nome do produto é obrigatório', 'error');
            return;
        }
        
        if (isNaN(preco) || preco <= 0) {
            this.showMessage('Preço deve ser um valor válido maior que zero', 'error');
            return;
        }
        
        if (isNaN(estoque) || estoque < 0) {
            this.showMessage('Estoque deve ser um número válido maior ou igual a zero', 'error');
            return;
        }
        
        try {
            const produtoData = { nome, preco, estoque, imagem: imagemFileName, codigo_barras, categoria_id: categoria_id ? parseInt(categoria_id) : null };

            if (this.editingProductId) {
                // Se nenhuma nova imagem foi enviada, mantenha a imagem existente
                if (!imagemFileName) {
                    const produtoExistente = this.produtos.find(p => p.id === this.editingProductId);
                    if (produtoExistente) {
                        produtoData.imagem = produtoExistente.imagem;
                    }
                }
                await this.updateProduct(this.editingProductId, produtoData);
                this.showMessage('Produto atualizado com sucesso!', 'success');
            } else {
                await this.addProduct(produtoData);
                this.showMessage('Produto adicionado com sucesso!', 'success');
            }

            // Centraliza a atualização da UI aqui
            await this.loadProducts();
            this.applyFilters(); // Esta função já chama renderProducts()
            this.updateProductCount();
            this.resetForm();

        } catch (error) {
            console.error('Erro ao salvar produto:', error);
            this.showMessage(`Erro ao salvar produto: ${error.message}`, 'error');
        }
    }

    async addProduct(produto) {
        return window.electronAPI.produtosAdicionar(produto);
    }

    async updateProduct(id, produto) {
        return window.electronAPI.produtosAtualizar(id, produto);
    }

    async deleteProduct(id) {
        if (!confirm('Tem certeza que deseja excluir este produto?')) {
            return;
        }
        
        try {
            await window.electronAPI.produtosExcluir(id);
            this.produtos = this.produtos.filter(p => p.id !== id);
            this.applyFilters();
            this.renderProducts();
            this.updateProductCount();
            this.showMessage('Produto excluído com sucesso!', 'success');
        } catch (error) {
            console.error('Erro ao excluir produto:', error);
            this.showMessage('Erro ao excluir produto', 'error');
        }
    }

    async editProduct(id) {
        const produto = this.produtos.find(p => p.id === id);
        if (!produto) return;
        
        document.getElementById('nome-produto').value = produto.nome;
        document.getElementById('preco-produto').value = produto.preco;
        document.getElementById('estoque-produto').value = produto.estoque;
        document.getElementById('codigo-barras-produto').value = produto.codigo_barras || '';
        document.getElementById('categoria-produto').value = produto.categoria_id || '';
        
        // Carregar imagem se existir
        if (produto.imagem) {
            const imagePath = await this.loadProductImage(produto);
            if (imagePath) {
                this.updateImagePreview(imagePath);
                this.currentImageData = null; // Não alterar imagem existente a menos que seja substituída
                this.currentImageFileName = produto.imagem;
            }
        } else {
            this.removeImage();
        }
        
        this.editingProductId = id;
        document.getElementById('form-title').textContent = 'Editar Produto';
        document.getElementById('btn-submit').innerHTML = '<i class="fas fa-save"></i> Atualizar Produto';
        document.getElementById('btn-cancel').style.display = 'block';
        
        // Scroll to form
        document.querySelector('.form-section').scrollIntoView({ behavior: 'smooth' });
    }

    cancelEdit() {
        this.resetForm();
    }

    resetForm() {
        document.getElementById('form-produto').reset();
        this.editingProductId = null;
        document.getElementById('form-title').textContent = 'Adicionar Produto';
        document.getElementById('btn-submit').innerHTML = '<i class="fas fa-save"></i> Salvar Produto';
        document.getElementById('btn-cancel').style.display = 'none';
        this.removeImage();
        document.getElementById('categoria-produto').value = ''; // Limpar preview de imagem
        this.clearMessage();
    }

    applyFilters() {
        let tempProdutos = [...this.produtos];

        // Aplicar filtro de busca
        if (this.currentSearchTerm) {
            tempProdutos = tempProdutos.filter(produto =>
                produto.nome.toLowerCase().includes(this.currentSearchTerm) ||
                (produto.codigo_barras && produto.codigo_barras.toLowerCase().includes(this.currentSearchTerm))
            );
        }

        // Aplicar filtro de categoria
        if (this.currentCategoryFilter !== 'all') {
            tempProdutos = tempProdutos.filter(produto => produto.categoria_id == this.currentCategoryFilter);
        }

        this.filteredProdutos = tempProdutos;
        this.renderProducts();
        this.updateProductCount();
    }

    renderProducts() {
        const tbody = document.querySelector('#tabela-produtos tbody');
        const emptyState = document.getElementById('empty-state');
        const table = document.getElementById('tabela-produtos');
        const searchTerm = document.getElementById('search-products').value.toLowerCase();

        // Limpa a tabela antes de renderizar para evitar duplicação
        tbody.innerHTML = '';
        
        if (this.filteredProdutos.length === 0) {
            table.style.display = 'none';
            emptyState.style.display = 'flex';
            return;
        }
        
        table.style.display = 'table';
        emptyState.style.display = 'none';
        
        this.filteredProdutos.forEach(async (produto) => {
            const tr = document.createElement('tr');
            
            // Determine stock status
            let stockClass = 'stock-high';
            if (produto.estoque <= 5) stockClass = 'stock-low';
            else if (produto.estoque <= 20) stockClass = 'stock-medium';
            
            // Carregar imagem se existir
            let imageHtml = '<div class="product-image-placeholder"><i class="fas fa-image"></i></div>';
            if (produto.imagem) {
                const imagePath = await this.loadProductImage(produto);
                if (imagePath) {
                    imageHtml = `<img src="${imagePath}" alt="${produto.nome}" class="product-table-image">`;
                }
            }
            
            tr.innerHTML = `
                <td>${produto.id}</td>
                <td>
                    <div class="product-info-cell">
                        <div class="product-image-cell">${imageHtml}</div>
                        <div class="product-name-cell">${produto.nome}</div>
                    </div>
                </td>
                <td>${produto.codigo_barras || 'N/A'}</td>
                <td class="price-display">R$ ${produto.preco.toFixed(2).replace('.', ',')}</td>
                <td class="stock-display ${stockClass}">${produto.estoque}</td>
                <td>${produto.categoria_nome || 'N/A'}</td>
                <td>
                    <button class="btn-edit" onclick="productManager.editProduct(${produto.id})">
                        <i class="fas fa-edit"></i> Editar
                    </button>
                    <button class="btn-delete" onclick="productManager.deleteProduct(${produto.id})">
                        <i class="fas fa-trash"></i> Excluir
                    </button>
                </td>
            `;
            
            tbody.appendChild(tr);
        });
    }

    updateProductCount() {
        const count = this.produtos.length;
        const countElement = document.getElementById('product-count');
        countElement.textContent = `${count} produto${count !== 1 ? 's' : ''}`;
    }

    showMessage(text, type = 'success') {
        const messageElement = document.getElementById('produto-msg');
        messageElement.textContent = text;
        messageElement.className = `message ${type}`;
        messageElement.style.display = 'block';
        
        // Auto-hide success messages
        if (type === 'success') {
            setTimeout(() => this.clearMessage(), 3000);
        }
    }

    clearMessage() {
        const messageElement = document.getElementById('produto-msg');
        messageElement.textContent = '';
        messageElement.className = 'message';
        messageElement.style.display = 'none';
    }
    
    handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        // Validar tipo de arquivo
        if (!file.type.startsWith('image/')) {
            this.showMessage('Por favor, selecione apenas arquivos de imagem', 'error');
            return;
        }
        
        // Validar tamanho (máximo 5MB)
        if (file.size > 5 * 1024 * 1024) {
            this.showMessage('A imagem deve ter no máximo 5MB', 'error');
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            this.currentImageData = e.target.result;
            this.currentImageFileName = file.name;
            this.updateImagePreview(e.target.result);
        };
        reader.readAsDataURL(file);
    }
    
    updateImagePreview(imageSrc) {
        const preview = document.getElementById('image-preview');
        preview.innerHTML = `
            <img src="${imageSrc}" alt="Preview">
            <button type="button" class="image-remove-btn" onclick="productManager.removeImage()">
                <i class="fas fa-times"></i>
            </button>
        `;
        preview.classList.add('has-image');
    }
    
    removeImage() {
        this.currentImageData = null;
        this.currentImageFileName = null;
        const preview = document.getElementById('image-preview');
        preview.innerHTML = `
            <i class="fas fa-image"></i>
            <span>Clique para adicionar uma imagem</span>
        `;
        preview.classList.remove('has-image');
        document.getElementById('imagem-produto').value = '';
    }
    
    async loadProductImage(produto) {
        if (produto.imagem) {
            try {
                const imagePath = await window.electronAPI.produtosObterCaminhoImagem(produto.imagem);
                if (imagePath) {
                    return `file://${imagePath}`;
                }
            } catch (error) {
                console.error('Erro ao carregar imagem:', error);
            }
        }
        return null;
    }

    async handleNewCategory() {
        const { value: nomeCategoria } = await Swal.fire({
            title: 'Nova Categoria',
            input: 'text',
            inputLabel: 'Nome da categoria',
            inputPlaceholder: 'Ex: Bebidas, Limpeza, etc.',
            showCancelButton: true,
            confirmButtonText: 'Adicionar',
            cancelButtonText: 'Cancelar',
            inputValidator: (value) => {
                if (!value) {
                    return 'Você precisa digitar um nome!';
                }
                if (this.categorias.some(c => c.nome.toLowerCase() === value.toLowerCase())) {
                    return 'Essa categoria já existe!';
                }
            }
        });

        if (nomeCategoria) {
            try {
                const novaCategoria = await window.electronAPI.categoriasAdicionar(nomeCategoria);
                this.categorias.push(novaCategoria);
                this.renderCategories();
                document.getElementById('categoria-produto').value = novaCategoria.id;
                this.showMessage(`Categoria "${nomeCategoria}" adicionada!`, 'success');
            } catch (error) {
                console.error('Erro ao adicionar categoria:', error);
                this.showMessage('Erro ao salvar nova categoria.', 'error');
            }
        }
    }
}

// Initialize when DOM is loaded
let productManager;
window.addEventListener('DOMContentLoaded', () => {
    productManager = new ProductManager();
    productManager.init(); // Ativa o gerenciador de produtos
});
