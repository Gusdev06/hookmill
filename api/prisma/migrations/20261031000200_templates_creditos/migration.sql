-- templates-creditos-v1 (31/10): catálogo de templates, livro-razão de créditos por conta e o lote de template. Aditiva.

-- CreateEnum
CREATE TYPE "TemplateTier" AS ENUM ('EDIT', 'STATIC', 'AI');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'LIVE', 'HIDDEN');

-- CreateEnum
CREATE TYPE "CreditPool" AS ENUM ('CREDITS', 'SAMPLE');

-- CreateEnum
CREATE TYPE "CreditEntryKind" AS ENUM ('GRANT', 'RESERVE', 'CHARGE', 'REFUND', 'MANUAL');

-- CreateEnum
CREATE TYPE "TemplateRunStatus" AS ENUM ('DRAFT', 'RESERVED', 'SETTLED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "credit_balance" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sample_uses" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "internal_key" TEXT NOT NULL,
    "auto_type" TEXT,
    "frame_id" TEXT,
    "pack" BOOLEAN NOT NULL DEFAULT false,
    "tier" "TemplateTier" NOT NULL,
    "credits" INTEGER,
    "outputs" INTEGER NOT NULL DEFAULT 1,
    "category" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_pt" TEXT NOT NULL,
    "desc_en" TEXT NOT NULL,
    "desc_pt" TEXT NOT NULL,
    "out_en" TEXT NOT NULL,
    "out_pt" TEXT NOT NULL,
    "needs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "beta" BOOLEAN NOT NULL DEFAULT false,
    "example_key" TEXT,
    "poster_key" TEXT,
    "example_duration_sec" DECIMAL(8,3),
    "pending_example_key" TEXT,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_runs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "account_id" TEXT,
    "pool" "CreditPool",
    "status" "TemplateRunStatus" NOT NULL DEFAULT 'DRAFT',
    "cap" INTEGER,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "held" INTEGER NOT NULL DEFAULT 0,
    "charged" INTEGER NOT NULL DEFAULT 0,
    "refunded" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT NOT NULL,
    "reserved_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "pool" "CreditPool" NOT NULL,
    "kind" "CreditEntryKind" NOT NULL,
    "delta" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "template_run_id" TEXT,
    "workspace_id" TEXT,
    "by_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "templates_slug_key" ON "templates"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "templates_internal_key_key" ON "templates"("internal_key");

-- CreateIndex
CREATE INDEX "templates_status_order_idx" ON "templates"("status", "order");

-- CreateIndex
CREATE UNIQUE INDEX "template_runs_batch_id_key" ON "template_runs"("batch_id");

-- CreateIndex
CREATE INDEX "template_runs_workspace_id_created_at_idx" ON "template_runs"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "template_runs_status_idx" ON "template_runs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "credit_entries_idempotency_key_key" ON "credit_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "credit_entries_user_id_created_at_idx" ON "credit_entries"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "credit_entries_template_run_id_idx" ON "credit_entries"("template_run_id");

-- AddForeignKey
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "variation_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_by_id_fkey" FOREIGN KEY ("by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_template_run_id_fkey" FOREIGN KEY ("template_run_id") REFERENCES "template_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Saldos nunca negativos (o CreditosService já faz CAS; o banco garante)
ALTER TABLE "users" ADD CONSTRAINT "users_credit_balance_nonneg" CHECK ("credit_balance" >= 0);
ALTER TABLE "users" ADD CONSTRAINT "users_sample_uses_nonneg" CHECK ("sample_uses" >= 0);
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_amounts_nonneg" CHECK ("held" >= 0 AND "charged" >= 0 AND "refunded" >= 0);

-- Catálogo inicial (templates-creditos-v1 §3). Sem vídeo de exemplo nenhum aparece pro cliente.
INSERT INTO "templates" ("id", "slug", "internal_key", "auto_type", "frame_id", "pack", "tier", "credits", "outputs", "category", "name_en", "name_pt", "desc_en", "desc_pt", "out_en", "out_pt", "needs", "order", "status", "beta", "updated_at") VALUES
('tpl_breaking_news', 'breaking-news', 'FRAME:news', 'FRAME', 'news', false, 'EDIT', 1, 1, 'frames', 'Breaking news', 'Notícia urgente', 'Your ad plays inside a news broadcast. The headline is written from your promise and proof.', 'Seu anúncio dentro de um telejornal. A manchete sai da sua promessa e da sua prova.', '1 video', '1 vídeo', ARRAY[]::TEXT[], 10, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_meme_pov', 'meme-pov', 'FRAME:meme', 'FRAME', 'meme', false, 'EDIT', 1, 1, 'frames', 'Meme POV', 'Meme POV', '"POV:" caption on top of your ad, written from the pain your buyer feels.', 'Legenda "POV:" em cima do anúncio, escrita a partir da dor de quem compra.', '1 video', '1 vídeo', ARRAY[]::TEXT[], 20, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_post_card', 'post-card', 'FRAME:post_card', 'FRAME', 'post_card', false, 'EDIT', 1, 1, 'frames', 'Post card', 'Post card', 'Your hook as a social post, your ad below it. No verified badge, no made-up numbers.', 'Seu gancho como post de rede social, o anúncio embaixo. Sem selo de verificado, sem número inventado.', '1 video', '1 vídeo', ARRAY[]::TEXT[], 30, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_question_box', 'question-box', 'FRAME:question_box', 'FRAME', 'question_box', false, 'EDIT', 1, 1, 'frames', 'Question box', 'Caixa de pergunta', 'A question sticker with the question your ad answers, your creator answering it.', 'Figurinha de pergunta com a dúvida que o anúncio responde, e quem fala respondendo.', '1 video', '1 vídeo', ARRAY[]::TEXT[], 40, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_top_5', 'top-5', 'FRAME:ranking', 'FRAME', 'ranking', false, 'EDIT', 1, 1, 'frames', 'Top 5', 'Top 5', 'A ranking built only from what your Brain says: pains, promise and proof.', 'Um ranking feito só com o que está no Cérebro: dores, promessa e prova.', '1 video', '1 vídeo', ARRAY['brain_points']::TEXT[], 50, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_live', 'live', 'FRAME:live', 'FRAME', 'live', false, 'EDIT', 1, 1, 'frames', 'Live', 'Live', 'Your ad framed as a live broadcast, with your handle and limited comments.', 'Seu anúncio como uma live, com o seu @ e comentários.', '1 video', '1 vídeo', ARRAY[]::TEXT[], 60, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_call', 'call', 'FRAME:call', 'FRAME', 'call', false, 'EDIT', 1, 1, 'frames', 'Call', 'Chamada', 'Your ad inside a video call, with the steps of your offer on a slide.', 'Seu anúncio numa chamada de vídeo, com os passos da oferta num slide.', '1 video', '1 vídeo', ARRAY['brain_points']::TEXT[], 70, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_cinema', 'cinema', 'FRAME:cinema', 'FRAME', 'cinema', false, 'EDIT', 1, 1, 'frames', 'Cinema', 'Cinema', 'Cinematic bars with a question and a subtitle that set up your ad.', 'Faixas de cinema com uma pergunta e um subtítulo que abrem o anúncio.', '1 video', '1 vídeo', ARRAY[]::TEXT[], 80, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_story', 'story', 'FRAME:story', 'FRAME', 'story', false, 'EDIT', 1, 1, 'frames', 'Story', 'Story', 'Your ad as a story: question sticker, headline and copy.', 'Seu anúncio como story: figurinha de pergunta, manchete e texto.', '1 video', '1 vídeo', ARRAY[]::TEXT[], 90, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_read_the_caption', 'read-the-caption', 'FRAME:read_caption', 'FRAME', 'read_caption', false, 'EDIT', 1, 1, 'frames', 'Read the caption', 'Leia a legenda', 'A headline on top and a caption to read below your ad.', 'Manchete em cima e uma legenda pra ler embaixo do anúncio.', '1 video', '1 vídeo', ARRAY[]::TEXT[], 100, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_pov_testimonial', 'pov-testimonial', 'FRAME:pov_testimonial', 'FRAME', 'pov_testimonial', false, 'EDIT', 1, 1, 'frames', 'POV testimonial', 'Depoimento POV', 'A testimonial-style POV, only from the proof in your Brain.', 'Um POV de depoimento, só com a prova que está no Cérebro.', '1 video', '1 vídeo', ARRAY['proof']::TEXT[], 110, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_direct_offer', 'direct-offer', 'FRAME:direct_offer', 'FRAME', 'direct_offer', false, 'EDIT', 1, 1, 'frames', 'Direct offer', 'Oferta direta', 'Promise, price and call to action, written exactly as in your Brain.', 'Promessa, preço e chamada, escritos exatamente como no Cérebro.', '1 video', '1 vídeo', ARRAY['price']::TEXT[], 120, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_split_screen', 'split-screen', 'FRAME:split_stack', 'FRAME', 'split_stack', false, 'EDIT', 1, 1, 'frames', 'Split screen', 'Tela dividida', 'Your creator on top. Below, stock footage that shows what she is saying.', 'Quem fala em cima. Embaixo, imagens de banco que mostram o que ela diz.', '1 video', '1 vídeo', ARRAY['face']::TEXT[], 130, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_split_torn', 'split-torn', 'FRAME:split_torn', 'FRAME', 'split_torn', false, 'EDIT', 1, 1, 'frames', 'Split torn', 'Tela rasgada', 'Your creator and matching footage split by a torn-paper edge.', 'Quem fala e imagens que combinam, separadas por papel rasgado.', '1 video', '1 vídeo', ARRAY['face']::TEXT[], 140, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_meet_dialog', 'meet-dialog', 'FRAME:call_dialog', 'FRAME', 'call_dialog', false, 'EDIT', 1, 1, 'frames', 'Meet dialog', 'Diálogo em chamada', 'Two windows of a video call: your creator and matching footage.', 'Duas janelas de chamada de vídeo: quem fala e imagens que combinam.', '1 video', '1 vídeo', ARRAY['face']::TEXT[], 150, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_gossip_page', 'gossip-page', 'FRAME:gossip_page', 'FRAME', 'gossip_page', false, 'EDIT', 1, 1, 'frames', 'Gossip page', 'Página de fofoca', 'Your ad as a post from a gossip page, with a headline that teases the promise.', 'Seu anúncio como post de página de fofoca, com manchete que provoca a promessa.', '1 video', '1 vídeo', ARRAY['face']::TEXT[], 160, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_gossip_white', 'gossip-white', 'FRAME:gossip_white', 'FRAME', 'gossip_white', false, 'EDIT', 1, 1, 'frames', 'Gossip white', 'Fofoca branca', 'Gossip-page post on a white card.', 'Post de página de fofoca em cartão branco.', '1 video', '1 vídeo', ARRAY['face']::TEXT[], 170, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_gossip_pink', 'gossip-pink', 'FRAME:gossip_pink', 'FRAME', 'gossip_pink', false, 'EDIT', 1, 1, 'frames', 'Gossip pink', 'Fofoca rosa', 'Gossip-page post on a pink card.', 'Post de página de fofoca em cartão rosa.', '1 video', '1 vídeo', ARRAY['face']::TEXT[], 180, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_new_headline', 'new-headline', 'HEADLINE', 'HEADLINE', NULL, false, 'EDIT', 1, 3, 'headline', 'New headline', 'Headline nova', 'Same video, three new written hooks over the first 3 seconds. Everything else stays.', 'O mesmo vídeo com três ganchos escritos novos nos 3 primeiros segundos. O resto fica igual.', '3 videos', '3 vídeos', ARRAY[]::TEXT[], 190, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_native_search', 'native-search', 'NATIVE_SEARCH', 'NATIVE_SEARCH', NULL, false, 'EDIT', 1, 1, 'headline', 'Native search', 'Busca nativa', 'Opens on a search bar typing the problem your hook names, then cuts to your ad.', 'Abre numa barra de busca digitando o problema do gancho e corta pro anúncio.', '1 video', '1 vídeo', ARRAY['speech']::TEXT[], 200, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_short_cuts', 'short-cuts', 'CUT', 'CUT', NULL, false, 'EDIT', 1, 2, 'cuts', 'Short cuts', 'Cortes curtos', '15 s and 20 s versions that keep your hook, your proof and your call to action.', 'Versões de 15 s e 20 s que mantêm o gancho, a prova e a chamada.', '2 videos', '2 vídeos', ARRAY['min_25s']::TEXT[], 210, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_review', 'review', 'REVIEW', 'REVIEW', NULL, false, 'EDIT', 1, 1, 'cuts', 'Review', 'Avaliação', 'A review card with a real quote from your proof, then your ad.', 'Um cartão de avaliação com uma frase real da sua prova, e depois o anúncio.', '1 video', '1 vídeo', ARRAY['proof']::TEXT[], 220, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_cold_open', 'cold-open', 'COLD_OPEN', 'COLD_OPEN', NULL, false, 'EDIT', 1, 1, 'cuts', 'Cold open', 'Abertura fria', 'Starts on the strongest moment of your ad, then goes back to the hook.', 'Começa no momento mais forte do anúncio e volta pro gancho.', '1 video', '1 vídeo', ARRAY[]::TEXT[], 230, 'DRAFT', false, CURRENT_TIMESTAMP),
('tpl_offer_end_card', 'offer-end-card', 'ENDCARD', 'ENDCARD', NULL, false, 'EDIT', 1, 1, 'cuts', 'Offer end card', 'Cartão final da oferta', 'Adds an end card with your offer, guarantee or price, taken from the Brain.', 'Acrescenta um cartão final com oferta, garantia ou preço, tirados do Cérebro.', '1 video', '1 vídeo', ARRAY['price']::TEXT[], 240, 'DRAFT', false, CURRENT_TIMESTAMP),
('tpl_chat_dm', 'chat-dm', 'CHAT_DM', 'CHAT_DM', NULL, false, 'EDIT', 1, 1, 'chat', 'Chat DM', 'Chat DM', 'Your ad turned into a Direct conversation: a buyer asks, the brand answers. No person, no voice.', 'Seu anúncio virado conversa de Direct: quem compra pergunta, a marca responde. Sem pessoa, sem voz.', '1 video · 9:16', '1 vídeo · 9:16', ARRAY['speech']::TEXT[], 250, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_person_motion', 'person-motion', 'PERSON_MOTION', 'PERSON_MOTION', NULL, false, 'EDIT', 1, 1, 'chat', 'Person + motion', 'Pessoa + motion', 'Your own creator in a box below, your promise animated above in sync with what she says.', 'Quem fala numa caixa embaixo e a promessa animada em cima, no ritmo da fala.', '1 video · 9:16', '1 vídeo · 9:16', ARRAY['face', 'speech', 'min_15s', 'clean_face']::TEXT[], 260, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_static_ad', 'static-ad', 'STATIC', 'STATIC', NULL, false, 'STATIC', 2, 1, 'static', 'Static ad', 'Anúncio estático', 'A new image ad made from your Brain, using your ad as reference. 9:16, 4:5 and 1:1.', 'Uma imagem nova feita do seu Cérebro, com o anúncio como referência. 9:16, 4:5 e 1:1.', '1 image', '1 imagem', ARRAY[]::TEXT[], 270, 'LIVE', false, CURRENT_TIMESTAMP),
('tpl_new_face', 'new-face', 'AVATAR_FACE', 'AVATAR_FACE', NULL, false, 'AI', 8, 3, 'avatar', 'New face', 'Rosto novo', 'Same video, same voice, same edit. Only the face changes, three times.', 'O mesmo vídeo, a mesma voz, a mesma edição. Só o rosto muda, três vezes.', '3 videos', '3 vídeos', ARRAY['face', 'speech']::TEXT[], 280, 'DRAFT', false, CURRENT_TIMESTAMP),
('tpl_new_persona', 'new-persona', 'AVATAR_PERSONA', 'AVATAR_PERSONA', NULL, false, 'AI', 9, 3, 'persona', 'New persona', 'Persona nova', 'Three different people in their own settings say your script, each opening adapted to them.', 'Três pessoas diferentes, cada uma no seu cenário, falam o roteiro com a abertura adaptada.', '3 videos', '3 vídeos', ARRAY['audience']::TEXT[], 290, 'DRAFT', false, CURRENT_TIMESTAMP),
('tpl_found_it_by_accident', 'found-it-by-accident', 'REMIX_DISCOVERY', 'REMIX_DISCOVERY', NULL, false, 'AI', 6, 3, 'remix', 'Found it by accident', 'Achei sem querer', 'Phone-in-hand discovery format. New script from your ad, a generated person, two extra hooks.', 'Formato "achei sem querer", celular na mão. Roteiro novo do seu anúncio, pessoa gerada, dois ganchos extras.', '1 video + 2 hooks', '1 vídeo + 2 ganchos', ARRAY['speech', 'promise_or_proof']::TEXT[], 300, 'DRAFT', false, CURRENT_TIMESTAMP),
('tpl_podcast_clip', 'podcast-clip', 'REMIX_PODCAST', 'REMIX_PODCAST', NULL, false, 'AI', NULL, 3, 'remix', 'Podcast clip', 'Corte de podcast', 'A host asks, a guest answers. Opens after our quality test.', 'Um apresentador pergunta, um convidado responde. Abre depois do nosso teste de qualidade.', '1 video + 2 hooks', '1 vídeo + 2 ganchos', ARRAY['speech']::TEXT[], 310, 'HIDDEN', true, CURRENT_TIMESTAMP),
('tpl_cinematic_remix', 'cinematic-remix', 'REMIX_KLING', 'REMIX_KLING', NULL, false, 'AI', NULL, 3, 'remix', 'Cinematic remix', 'Remix cinematográfico', 'The discovery format with cinematic motion (Kling 3.0).', 'O formato "achei sem querer" com movimento de cinema (Kling 3.0).', '1 video + 2 hooks', '1 vídeo + 2 ganchos', ARRAY['speech', 'promise_or_proof']::TEXT[], 320, 'DRAFT', false, CURRENT_TIMESTAMP),
('tpl_let_hookmill_pick', 'let-hookmill-pick', 'PACK', NULL, NULL, true, 'EDIT', 10, 12, 'pack', 'Let HookMill pick', 'Deixa o HookMill escolher', 'Every Edit template that fits your ad, picked and written for you. Uncheck what you don''t want. Never more than 10 credits.', 'Todos os templates de Edição que cabem no seu anúncio, escolhidos e escritos pra você. Desmarque o que não quiser. Nunca mais que 10 créditos.', 'Up to 12 videos', 'Até 12 vídeos', ARRAY[]::TEXT[], 330, 'LIVE', false, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
