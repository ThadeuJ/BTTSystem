# BTT System

Aplicação local para traduzir textos longos em blocos usando diretamente a API da OpenAI ou do OpenRouter.

## Objetivo

O sistema recebe um texto colado no navegador, divide o conteúdo em blocos e envia cada bloco sequencialmente para o modelo escolhido. A tradução deve preservar quebras de linha, Markdown, HTML, placeholders, URLs e demais elementos de formatação.

## Provedores

- **OpenRouter:** permite escolher entre diversos modelos e costuma oferecer opções econômicas.
- **OpenAI API:** permite usar os modelos disponíveis diretamente na conta da plataforma OpenAI.

A assinatura do ChatGPT não autentica chamadas de API. Este aplicativo utiliza uma chave de API colada pelo usuário.

## Requisitos

- Node.js 18 ou mais recente
- Uma chave da OpenAI API ou do OpenRouter

## Executar

```bash
npm install
npm start
```

Abra `http://localhost:3000`, selecione o provedor e cole a chave. Os modelos rápidos ficam disponíveis imediatamente, sem uma chamada adicional para listar modelos.

## Segurança da chave

A chave é mantida somente na memória da página durante a sessão. Ela não é salva no `localStorage`, não é gravada em arquivo e não deve ser colocada no código-fonte. O backend também não registra a chave nos logs.

Este protótipo é destinado a uso local. Não exponha o backend publicamente.

## Protótipo atual

- Seleção entre OpenAI API e OpenRouter.
- Lista imediata de modelos compatíveis por provedor, sem depender de uma consulta de catálogo.
- Seleção manual de modelo.
- Caixa de texto para colar conteúdo.
- Importação de arquivos `.txt`, `.md`, `.pdf` e `.epub`.
- Seleção individual de páginas de PDF ou seções de EPUB.
- Idioma de origem e destino.
- Divisão inicial por parágrafos e limite aproximado de caracteres.
- Tradução sequencial dos bundles via `chat/completions` com streaming.
- Cada bundle aparece na área de resultado enquanto a resposta chega.
- Pausa e retomada entre bundles.
- Salvamento local de chave, texto, páginas selecionadas e seções traduzidas.
- Resultado final e botão para copiar.

## Próximas etapas

1. Melhorar a divisão por Markdown, HTML e limites reais de tokens.
2. Adicionar contexto controlado e glossário.
3. Validar que nenhum conteúdo foi perdido.
4. Adicionar testes automatizados.
5. Criar uma lista de modelos recomendados para tradução.
