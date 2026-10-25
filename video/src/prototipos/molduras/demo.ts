// Textos de demonstração (PT-BR) pra oferta fictícia "Coluna Leve": app com rotina noturna de 10 min pra dor nas costas.
// Preço da Oferta direta é de EXEMPLO (R$ 97 -> R$ 47). Mídia = fixtures locais (public/fixtures), nada gerado.
import type { MarcaMoldura, MidiasMoldura, MolduraProps } from './tipos';

const marca: MarcaMoldura = { nome: 'Coluna Leve', handle: 'colunaleve', iniciais: 'CL', cor: '#5B4BF5' };
const take = { src: 'fixtures/real-take.mp4', inicioSec: 0, foco: { x: 0.5, y: 0.3 } };
const midias: MidiasMoldura = { principal: take, segunda: { src: 'fixtures/real-kling-2.mp4', foco: { x: 0.5, y: 0.32 } }, rosto: 'fixtures/rosto-take.jpg' };
const midiasPodcast: MidiasMoldura = { ...midias, segunda: { src: 'fixtures/cena-2.mp4', foco: { x: 0.55, y: 0.35 } } };
const D = 8;

export const DEMO_MOLDURAS: { id: string; nome: string; props: MolduraProps }[] = [
  { id: '01-caixinha', nome: 'Caixinha', props: { template: 'question_box', duracaoSec: D, marca, midias, textos: { question: 'Por que eu acordo com *mais dor* do que quando fui dormir?' } } },
  { id: '02-choquei', nome: 'Choquei', props: { template: 'gossip_page', duracaoSec: D, marca, midias, textos: { pageName: 'Plantão Bem-Estar', headline: 'Ele acordava travado todo santo dia. *Até mudar os 10 minutos antes de dormir.* Veja o que ele faz agora:' } } },
  { id: '03-meme', nome: 'Meme', props: { template: 'meme', duracaoSec: D, marca, midias, textos: { pov: 'você acorda e a primeira coisa que sente é a lombar reclamando', cta: 'Toque no botão e use' } } },
  { id: '04-cinema', nome: 'Cinema', props: { template: 'cinema', duracaoSec: D, marca, midias, textos: { question: 'E se essa dor não fosse *da idade*?', subtitle: 'Dez minutos antes de dormir mudam o jeito que você acorda.' } } },
  { id: '05-noticia', nome: 'Notícia', props: { template: 'news', duracaoSec: D, marca, midias, textos: { topic: 'Saúde', headline: { lead: 'Rotina de 10 minutos mostra:', highlight: 'a dor da manhã começa na noite' }, dek: 'Movimentos leves antes de deitar soltam a lombar pra você acordar sem aquela rigidez.', cta: 'Toque no botão e veja' } } },
  { id: '06-tela-dividida', nome: 'Tela dividida', props: { template: 'split_stack', duracaoSec: D, marca, midias, textos: { headline: 'Você não nasceu pra *acordar com dor*' } } },
  { id: '07-tela-dividida-2', nome: 'Tela dividida 2', props: { template: 'split_torn', duracaoSec: D, marca, midias: midiasPodcast, textos: { headline: 'Sua coluna pede *10 minutos*, não um milagre' } } },
  { id: '08-google-meet', nome: 'Google Meet', props: { template: 'call', duracaoSec: D, marca, midias, textos: { title: 'Rotina noturna · Coluna Leve', slideTitle: 'Noite 1: *soltar a lombar*', slideSteps: ['Respirar e soltar o quadril', 'Gato-vaca bem devagar', 'Joelhos ao peito, 1 min'] } } },
  { id: '09-meet-dialogo', nome: 'Meet diálogo', props: { template: 'call_dialog', duracaoSec: D, marca, midias, textos: { title: 'Conversa sobre dor nas costas', names: ['Você', 'Fisio'] } } },
  { id: '10-ranking', nome: 'Ranking', props: { template: 'ranking', duracaoSec: D, marca, midias, textos: { title: 'O que trava sua coluna', items: ['Dormir de bruços', 'Celular na cama', 'Deitar sem alongar', 'Travesseiro alto demais', 'Pular a rotina da noite'] } } },
  { id: '11-tweet', nome: 'Tweet', props: { template: 'post_card', duracaoSec: D, marca, midias, textos: { copy: 'Ninguém te contou, mas a dor que você sente de manhã *começa na noite anterior.*' } } },
  { id: '12-oferta-direta', nome: 'Oferta direta', props: { template: 'direct_offer', duracaoSec: D, marca, midias, textos: { promise: 'Sua coluna *leve* de novo', price: { from: 'R$ 97', to: 'R$ 47' }, cta: 'Toque no botão e garanta' } } },
  { id: '13-story', nome: 'Story', props: { template: 'story', duracaoSec: D, marca, midias, textos: {
    question: 'Por que minhas costas doem mais de manhã?', headline: 'Isso tem nome. E tem saída.',
    support: '10 minutos antes de dormir. *Sem academia, sem aparelho.*',
    copy: 'Você passa o dia carregando peso, senta torto, deita exausto. A coluna não descansa: ela *trava*. O Coluna Leve te guia numa rotina de 10 minutos na cama, toda noite, pra você *acordar inteiro* de novo.' } } },
  { id: '14-leia-a-legenda', nome: 'Leia a legenda', props: { template: 'read_caption', duracaoSec: D, marca, midias, textos: { headline: 'O detalhe da sua noite que *decide como você acorda*', primaryText: 'A dor da manhã quase nunca é da manhã. Ela vem do jeito que a coluna passa a noite: travada, sem ter soltado o dia. O Coluna Leve é uma rotina de 10 minutos na cama, antes de dormir, que solta lombar e quadril. Toque em Saiba mais e faça a primeira noite hoje.' } } },
  { id: '15-pov-depoimento', nome: 'POV + depoimento', props: { template: 'pov_testimonial', duracaoSec: D, marca, midias, textos: { pov: 'você fez a rotina de 10 minutos por uma semana e acordou sem travar', cta: 'Clique no botão para testar' } } },
  { id: '16-live', nome: 'Live', props: { template: 'live', duracaoSec: D, marca, midias, textos: {} } },
  { id: '17-fofoca-1', nome: 'Fofoca 1', props: { template: 'gossip_white', duracaoSec: D, marca, midias, textos: { headline: 'Veja como esse homem *parou de acordar travado* com 10 minutos por noite' } } },
  { id: '18-fofoca-2', nome: 'Fofoca 2', props: { template: 'gossip_pink', duracaoSec: D, marca, midias: midiasPodcast, textos: { headline: 'Ele jurava que era a idade. *Era o que fazia antes de dormir.*' } } },
];
