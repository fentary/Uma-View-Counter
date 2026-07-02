# Meu View Counter (v2 — nunca zera)

Contador de visualizações com imagens. Diferente da primeira versão, agora os
números ficam guardados no **Upstash Redis**, um banco de dados separado do
servidor — então mesmo que o site "durma" ou você faça um novo deploy, o
contador continua exatamente de onde parou.

## Passo a passo completo

### 1. Suba o projeto para o GitHub

- Crie um repositório novo em https://github.com/new
- Envie todos os arquivos desta pasta pra ele (pelo site mesmo, arrastando os
  arquivos em "uploading an existing file")

### 2. Crie o projeto no Vercel

1. Acesse https://vercel.com e entre com sua conta do GitHub
2. Clique em "Add New..." → "Project"
3. Selecione o repositório que você acabou de criar
4. Pode deixar todas as configurações no padrão e clicar em "Deploy"
   - O primeiro deploy pode até dar erro (porque ainda falta o banco de
     dados) — sem problema, a gente resolve no próximo passo

### 3. Conecte o banco de dados (Upstash Redis)

1. Dentro do seu projeto no Vercel, clique na aba **Storage**
2. Clique em **Create Database** (ou "Browse Marketplace" → procure por
   **Upstash**)
3. Escolha **Redis**
4. Dê um nome pra ele (qualquer nome, ex: `contador-db`) e escolha a região
   mais próxima de você
5. Clique em **Connect** / **Create** e confirme que ele deve se conectar ao
   seu projeto (o Vercel vai perguntar quais projetos usam esse banco —
   selecione o seu)

Isso faz o Vercel criar automaticamente duas variáveis de ambiente no seu
projeto: `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`. É assim que o
código sabe onde guardar os números — você não precisa copiar nada
manualmente.

### 4. Faça o deploy de novo

1. Vá na aba **Deployments**
2. Clique nos "..." do último deploy → **Redeploy**
   (agora que o banco está conectado, vai funcionar)

### 5. Use!

Acesse a URL que o Vercel te deu (tipo `https://seu-projeto.vercel.app`) —
vai abrir a página pra gerar seu link do contador. Cada link gerado é
independente: se você e um amigo criarem nomes diferentes, cada um tem sua
própria contagem, guardada para sempre.

## E se eu quiser testar no meu computador antes?

Você vai precisar:
1. Ter o Node.js instalado
2. Criar uma conta grátis em https://upstash.com e criar um banco Redis lá
   diretamente (em vez de pelo Vercel)
3. Copiar a "REST URL" e o "REST TOKEN" que o Upstash mostra
4. Criar um arquivo `.env.local` nesta pasta com:
   ```
   UPSTASH_REDIS_REST_URL=cole_aqui
   UPSTASH_REDIS_REST_TOKEN=cole_aqui
   ```
5. Instalar a ferramenta do Vercel e rodar localmente:
   ```
   npm install -g vercel
   npm install
   vercel dev
   ```

Isso é opcional — o mais simples mesmo é ir direto pros passos 1 a 5 acima e
testar já no ar.
