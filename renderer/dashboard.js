document.addEventListener('DOMContentLoaded', () => {
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');
    const filterBtn = document.getElementById('filter-btn');

    // Define as datas padrão como hoje
    const today = new Date().toISOString().slice(0, 10);
    startDateInput.value = today;
    endDateInput.value = today;

    let salesChart = null;
    let paymentChart = null;

    async function loadDashboardData() {
        const startDate = startDateInput.value;
        const endDate = endDateInput.value;

        if (!startDate || !endDate) {
            alert('Por favor, selecione as datas de início e fim.');
            return;
        }

    try {
        const data = await window.electronAPI.dashboardDados({ startDate, endDate });
        console.log('Dados do dashboard:', data);

        // 1. Atualizar Resumo do Dia
        document.getElementById('faturamento-total').textContent = `R$ ${data.resumoDia.faturamentoTotal?.toFixed(2) || '0.00'}`;
        document.getElementById('numero-vendas').textContent = data.resumoDia.numeroVendas || 0;
        document.getElementById('ticket-medio').textContent = `R$ ${data.resumoDia.ticketMedio?.toFixed(2) || '0.00'}`;

        // 2. Atualizar Produtos Mais Vendidos
        const produtosContainer = document.getElementById('produtos-mais-vendidos-container');
        produtosContainer.innerHTML = ''; // Limpa o container
        if (data.produtosMaisVendidos.length > 0) {
            const productList = document.createElement('ul');
            productList.className = 'top-products-list';
            data.produtosMaisVendidos.forEach((produto, index) => {
                const li = document.createElement('li');
                li.className = 'top-product-item';
                li.innerHTML = `
                    <span class="product-rank">${index + 1}</span>
                    <span class="product-name">${produto.nome}</span>
                    <span class="product-sales">${produto.totalVendido} vendidos</span>
                `;
                productList.appendChild(li);
            });
            produtosContainer.appendChild(productList);
        } else {
            produtosContainer.innerHTML = '<p class="no-sales">Nenhuma venda registrada no período.</p>';
        }

        // 3. Gráfico de Desempenho de Vendas
        const desempenhoCtx = document.getElementById('desempenho-vendas-chart').getContext('2d');
                if (salesChart) salesChart.destroy();
        salesChart = new Chart(desempenhoCtx, {
            type: 'bar',
            data: {
                labels: data.desempenhoVendas.map(d => new Date(d.dia + 'T00:00:00').toLocaleDateString()),
                datasets: [{
                    label: 'Faturamento',
                    data: data.desempenhoVendas.map(d => d.faturamento),
                    backgroundColor: 'rgba(75, 192, 192, 0.6)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    borderWidth: 1,
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });

        // 4. Gráfico de Métodos de Pagamento
        const metodosCtx = document.getElementById('metodos-pagamento-chart').getContext('2d');
                if (paymentChart) paymentChart.destroy();
        // helper para capitalizar labels (primeira letra maiúscula)
        const toTitle = (s) => {
            if (!s) return s;
            const str = String(s).trim().toLowerCase();
            return str.charAt(0).toUpperCase() + str.slice(1);
        };

        paymentChart = new Chart(metodosCtx, {
            type: 'pie',
            data: {
                labels: data.metodosPagamento.map(m => toTitle(m.metodo_pagamento)),
                datasets: [{
                    label: 'Quantidade de Vendas',
                    data: data.metodosPagamento.map(m => m.quantidade),
                    backgroundColor: [
                        'rgba(255, 99, 132, 0.7)',
                        'rgba(54, 162, 235, 0.7)',
                        'rgba(255, 206, 86, 0.7)',
                        'rgba(75, 192, 192, 0.7)',
                    ]
                }]
            }
        });

    } catch (error) {
        console.error('Erro ao carregar dados do dashboard:', error);
        alert('Não foi possível carregar os dados do dashboard. Verifique o console para mais detalhes.');
        }
    }

    filterBtn.addEventListener('click', loadDashboardData);

    // Carrega os dados iniciais
    loadDashboardData();
});
