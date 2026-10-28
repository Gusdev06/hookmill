// Registro da composição de produto `Template` (iterate-v2 F1.4) no Root. Fica num arquivo próprio pra o Root só ganhar
// uma linha. As props de exemplo (Studio) são um chat EN sem mídia; o render de produção recebe as do buildTemplateInput.
import React from 'react';
import { Composition } from 'remotion';
import { CHAT_CLOSE_SEC, TEMPLATE_COMPOSITION_ID, TEMPLATE_SAFE, chatTimeline, templateSchema, type ChatIn, type TemplateProps } from '../lib/templatesFormato';
import { calcularTemplate, Template } from './Template';

const chat: ChatIn = {
  hook: { text: 'Still saying it the hard way?', highlight: 'the hard way' },
  chrome: { typing: 'typing…', inputPlaceholder: 'Message…', profileStatus: 'Online coach' },
  messages: [
    { from: 'prospect', kind: 'question', text: 'Hi! I tried a few methods already. Does this one work if I only have 10 minutes a day?', wrong: [], right: [] },
    { from: 'brand', kind: 'answer', text: 'Yes. The lessons are short on purpose.', wrong: [], right: [] },
    { from: 'brand', kind: 'correction', text: 'What changes', wrong: ['Memorizing lists'], right: ['Practicing real sentences'], },
    { from: 'prospect', kind: 'objection', text: 'And if I get stuck halfway?', wrong: [], right: [] },
    { from: 'brand', kind: 'answer', text: 'You get feedback on every exercise, so you always know the next step.', wrong: [], right: [] },
    { from: 'brand', kind: 'offer', text: 'Free class', wrong: [], right: ['Short daily lessons', 'Feedback on every exercise'] },
  ],
  close: { lines: ['Start today', 'in 10 minutes'] },
  cta: { button: 'Book a free class', note: 'No card needed' },
  proof: [],
};
const ag = chatTimeline(chat, 'en');
export const DEMO_TEMPLATE: TemplateProps = {
  templateId: 'chat-dm', format: 'VERTICAL_9_16', fps: 30, language: 'en',
  brand: { name: 'Acme School', handle: '@acmeschool', initials: 'AS', color: '#F2C14E' },
  palette: [], safeArea: { ...TEMPLATE_SAFE }, sfx: { pop: 'sfx/pop.wav', send: 'sfx/send.wav', ding: 'sfx/ding.wav' },
  durationInFrames: Math.round(ag.endSec * 30), checkpoints: [],
  props: { ...chat, messages: chat.messages.map((m, i) => ({ ...m, ...ag.messages[i] })), close: { atSec: ag.closeAtSec, lines: chat.close.lines } },
};
void CHAT_CLOSE_SEC;

export const TemplatesRegistrados: React.FC = () => (
  <Composition
    id={TEMPLATE_COMPOSITION_ID}
    component={Template}
    schema={templateSchema}
    defaultProps={DEMO_TEMPLATE}
    calculateMetadata={calcularTemplate}
    durationInFrames={DEMO_TEMPLATE.durationInFrames}
    fps={30}
    width={1080}
    height={1920}
  />
);
