import { expiresOf, hostOf, mapLibraryAd, splitItems } from './mapear';

const OE = Math.floor(Date.UTC(2026, 10, 8, 14) / 1000).toString(16);

const videoItem = {
  ad_archive_id: '111',
  page_id: '555',
  page_name: 'Hallow ',
  is_active: true,
  start_date: Date.UTC(2026, 8, 1) / 1000,
  end_date: Date.UTC(2026, 10, 4) / 1000,
  collation_count: 3,
  publisher_platform: ['facebook', 'INSTAGRAM', 'THREADS', 'WHATSAPP', 'SOMETHING_NEW'],
  url: 'https://www.facebook.com/ads/library/?q=%22daily%20prayer%22&search_type=keyword_exact_phrase',
  snapshot: {
    display_format: 'VIDEO',
    page_profile_picture_url: 'https://scontent.fbcdn.net/p.jpg',
    page_like_count: 627700,
    body: { text: 'Pray every day with the most loved prayer app in the world.' },
    title: 'Start praying',
    cta_text: 'Install now',
    link_url: 'https://www.hallow.com/start?x=1',
    videos: [{ video_hd_url: `https://video.fbcdn.net/v.mp4?oe=${OE}&oh=x`, video_sd_url: null, video_preview_image_url: `https://scontent.fbcdn.net/poster.jpg?oe=${OE}` }],
    cards: [],
    images: [],
  },
};

describe('mapear (Ad Radar)', () => {
  it('mapeia vídeo: plataformas válidas, host sem www, curtidas, validade pelo oe, termo de busca', () => {
    const ad = mapLibraryAd(videoItem)!;
    expect(ad).toMatchObject({
      adArchiveId: '111', pageId: '555', pageName: 'Hallow', pageLikeCount: 627700, format: 'VIDEO', hasVideo: true,
      platforms: ['FACEBOOK', 'INSTAGRAM', 'THREADS', 'WHATSAPP'], linkHost: 'hallow.com', startDate: '2026-09-01',
      collationCount: 3, isActive: true, cards: [], searchTerm: 'daily prayer', language: 'en',
    });
    expect(ad.mediaExpiresAt).toBe('2026-11-08T14:00:00.000Z');
    expect(ad.videoUrl).toContain('v.mp4');
    expect(ad.posterUrl).toContain('poster.jpg');
  });

  it('DCO: vídeo vem do card, cards preservados com tipo de mídia', () => {
    const ad = mapLibraryAd({
      ad_archive_id: '222', page_name: 'X', publisher_platform: [],
      snapshot: {
        display_format: 'DCO', body: { text: '{{product.brand}}' },
        cards: [
          { title: 'Card 1', body: 'b1', link_url: 'https://x.com/a', original_image_url: 'https://img/1.jpg' },
          { title: 'Card 2', body: 'b2', video_sd_url: 'https://video/2.mp4', video_preview_image_url: 'https://img/2p.jpg' },
        ],
      },
    })!;
    expect(ad.format).toBe('DCO');
    expect(ad.hasVideo).toBe(true);
    expect(ad.videoUrl).toBe('https://video/2.mp4');
    expect(ad.posterUrl).toBe('https://img/2p.jpg');
    expect(ad.cards.map((c) => c.mediaKind)).toEqual(['IMAGE', 'VIDEO']);
    expect(ad.mediaExpiresAt).toBeNull();
  });

  it('separa itens de erro (cobrados) e deduplica por ad_archive_id', () => {
    const { items, errors } = splitItems([videoItem, { ...videoItem }, { error: 'Page is private', errorCode: 'PAGE_PRIVATE' }, null, 'lixo']);
    expect(items).toHaveLength(1);
    expect(errors).toEqual([{ code: 'PAGE_PRIVATE', message: 'Page is private' }]);
  });

  it('formato desconhecido cai pelo conteúdo; IMAGE usa a imagem como poster', () => {
    const ad = mapLibraryAd({ ad_archive_id: '333', page_name: 'Y', snapshot: { display_format: 'WEIRD', images: [{ original_image_url: 'https://img/o.jpg' }] } })!;
    expect(ad.format).toBe('IMAGE');
    expect(ad.hasVideo).toBe(false);
    expect(ad.posterUrl).toBe('https://img/o.jpg');
  });

  it('helpers', () => {
    expect(hostOf('https://WWW.Foo.com/x')).toBe('foo.com');
    expect(hostOf('nada')).toBeNull();
    expect(expiresOf('https://x/y.mp4')).toBeNull();
  });
});
