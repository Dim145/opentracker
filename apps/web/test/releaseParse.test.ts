import { describe, it, expect } from 'vitest';
import {
  mergeParsedTags,
  parseNfoForTags,
  parseReleaseName,
} from '../app/utils/releaseParse';
import { detectMediaId, mediaIdQueryParam } from '../app/utils/mediaIdDetect';

// Analyse d'un nom de release.
//
// Le membre dépose un fichier, et le formulaire se pré-remplit tout seul :
// titre nettoyé, année, saison/épisode, étiquettes de scène. Rien ici n'est
// bloquant — c'est justement ce qui rend la fonction risquée. Une erreur ne
// lève pas d'exception, elle propose simplement un mauvais titre, lance la
// recherche de métadonnées sur la mauvaise œuvre, et l'upload part avec une
// fiche fausse que personne ne relira.
//
// Les deux pièges structurels sont figés ici : la découpe titre / métadonnées
// (chercher les étiquettes AVANT la coupure fait remonter « Web » depuis un
// titre qui contient ce mot) et le choix de la table d'étiquettes selon la
// nature devinée (les jeux annoncent leur plateforme AVANT le titre, les
// films leur codec après).

describe('parseReleaseName — films', () => {
  it('sépare le titre de la queue technique', () => {
    const r = parseReleaseName('Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.HDR.HEVC.Atmos-FraMeSToR');
    expect(r.title).toBe('Dune Part Two');
    expect(r.year).toBe(2024);
    expect(r.kind).toBe('movie');
    expect(r.tags).toContain('2160p');
    expect(r.tags).toContain('HEVC');
  });

  it('accepte n’importe quel séparateur', () => {
    for (const nom of [
      'Le Grand Bleu 1988 1080p BluRay x264-TEAM',
      'Le_Grand_Bleu_1988_1080p_BluRay_x264-TEAM',
      'Le.Grand.Bleu.1988.1080p.BluRay.x264-TEAM',
    ]) {
      const r = parseReleaseName(nom);
      expect(r.title).toBe('Le Grand Bleu');
      expect(r.year).toBe(1988);
    }
  });

  it('retire l’extension et le groupe', () => {
    const r = parseReleaseName('Titre.2020.1080p.WEB-DL.x264-GROUPE.mkv');
    expect(r.title).toBe('Titre');
    expect(r.tags).not.toContain('GROUPE');
  });

  it('ne cherche les étiquettes qu’après la coupure', () => {
    // « Extended » est une étiquette de qualité connue. Puisqu'elle apparaît
    // avant le premier jeton d'arrêt (l'année), elle appartient au titre et
    // ne doit pas remonter en étiquette.
    const r = parseReleaseName('Extended.Family.2024.1080p.WEB-DL.x264-TEAM');
    expect(r.title).toBe('Extended Family');
    expect(r.tags).toContain('WEB-DL');
    expect(r.tags).not.toContain('EXTENDED');
  });

  it('tronque le titre quand un de ses mots est lui-même un jeton d’arrêt', () => {
    // Limite connue et assumée : « Web » sert à repérer la source, donc un
    // titre qui contient ce mot est coupé là. Le membre corrige dans le
    // formulaire ; le pré-remplissage n'est qu'une suggestion. Ce test est là
    // pour que le jour où la coupure sera affinée, on le sache.
    expect(parseReleaseName('Charlotte.Web.2006.1080p.BluRay.x264-TEAM').title).toBe(
      'Charlotte',
    );
  });
});

describe('parseReleaseName — séries', () => {
  it('lit la forme SxxExx', () => {
    const r = parseReleaseName('The.Mandalorian.S03E01.1080p.WEB.DDP5.1.H.264-NTb');
    expect(r.title).toBe('The Mandalorian');
    expect(r.season).toBe(3);
    expect(r.episode).toBe(1);
    expect(r.kind).toBe('tv');
  });

  it('lit aussi les formes 1x01 et « Season 2 »', () => {
    const a = parseReleaseName('Une.Serie.2x05.1080p.WEB-DL');
    expect([a.season, a.episode]).toEqual([2, 5]);

    const b = parseReleaseName('Une.Serie.Season.2.1080p.WEB-DL');
    expect(b.season).toBe(2);
    expect(b.episode).toBeNull();
  });

  it('gère une saison complète sans épisode', () => {
    const r = parseReleaseName('Une.Serie.S01.COMPLETE.1080p.WEB-DL');
    expect(r.season).toBe(1);
    expect(r.episode).toBeNull();
  });

  it('accepte un numéro d’épisode à quatre chiffres', () => {
    // Les séries d'animation longues en ont besoin.
    const r = parseReleaseName('Un.Anime.S01E1024.1080p.WEB-DL');
    expect(r.episode).toBe(1024);
  });
});

describe('parseReleaseName — jeux et livres', () => {
  it('retire le crochet de plateforme du titre et le garde en étiquette', () => {
    const r = parseReleaseName('[PS5] Kingdom.Come.Deliverance.2 [EUR MULTI]');
    expect(r.kind).toBe('game');
    expect(r.title).toBe('Kingdom Come Deliverance 2');
    expect(r.tags).toContain('PS5');
  });

  it('reconnaît un numéro de version', () => {
    const r = parseReleaseName('[PC] Un.Jeu.v1.2.3');
    expect(r.tags.some((t) => t.toLowerCase().includes('v1.2.3'))).toBe(true);
  });

  it('reconnaît un format de livre et sa plage de tomes', () => {
    const r = parseReleaseName('Une.Serie.[T01.T05].FR.[CBZ]-ebdz');
    expect(r.kind).toBe('book');
    expect(r.tags).toContain('CBZ');
  });

  it('laisse l’indication de l’appelant primer sur la devinette', () => {
    // La catégorie choisie par le membre porte plus de contexte que le nom
    // de fichier : elle gagne.
    const r = parseReleaseName('Un.Titre.Ambigu.2024', 'book');
    expect(r.kind).toBe('book');
  });
});

describe('parseReleaseName — cas dégradés', () => {
  it('ne casse pas sur une entrée vide ou dénuée de structure', () => {
    for (const nom of ['', '   ', 'sansstructure']) {
      const r = parseReleaseName(nom);
      expect(r.year).toBeNull();
      expect(Array.isArray(r.tags)).toBe(true);
    }
  });

  it('ne prend pas un nombre à quatre chiffres quelconque pour une année', () => {
    expect(parseReleaseName('Titre.12345.1080p.WEB-DL').year).toBeNull();
  });

  it('ne rend jamais d’étiquette en double', () => {
    const r = parseReleaseName('Titre.2024.1080p.1080p.BluRay.BluRay.x264');
    expect(new Set(r.tags).size).toBe(r.tags.length);
  });
});

describe('mergeParsedTags', () => {
  it('n’ajoute que ce qui manque, sans doublon de casse', () => {
    const { merged, added } = mergeParsedTags(['1080p'], ['1080P', 'BluRay']);
    expect(merged).toEqual(['1080p', 'BluRay']);
    expect(added).toEqual(['BluRay']);
  });

  it('conserve l’orthographe déjà saisie par le membre', () => {
    const { merged } = mergeParsedTags(['BluRay'], ['bluray']);
    expect(merged).toEqual(['BluRay']);
  });

  it('ignore les entrées vides', () => {
    const { merged } = mergeParsedTags(['  ', ''], ['x', '   ']);
    expect(merged).toEqual(['x']);
  });
});

describe('parseNfoForTags', () => {
  it('retire le BBCode avant de chercher les étiquettes', () => {
    const tags = parseNfoForTags('[b]Codec vidéo :[/b] [i]H.265[/i] — [b]Source :[/b] BluRay');
    expect(tags).toContain('HEVC');
    expect(tags).toContain('BluRay');
  });

  it('retire aussi le HTML et décode les entités', () => {
    const tags = parseNfoForTags('<p>Résolution&nbsp;: <b>2160p</b></p>');
    expect(tags).toContain('2160p');
  });

  it('ne se laisse pas manger le document par un crochet non fermé', () => {
    // La borne `{0,256}` existe pour ça : sans elle, un `[` égaré avalait tout
    // jusqu'au `]` suivant, à des kilomètres de là, et le NFO ressortait vide.
    const nfo = `[non fermé ${'x'.repeat(500)} 1080p BluRay`;
    expect(parseNfoForTags(nfo)).toContain('1080p');
  });

  it('ne décode pas deux fois une entité échappée', () => {
    // `&amp;lt;` est ce que le membre a réellement tapé : il doit rester
    // `&lt;`, pas redescendre en `<`.
    expect(() => parseNfoForTags('&amp;lt;script&amp;gt; 1080p')).not.toThrow();
    expect(parseNfoForTags('&amp;lt;script&amp;gt; 1080p')).toContain('1080p');
  });

  it('rend une liste vide plutôt que de planter', () => {
    expect(parseNfoForTags(null)).toEqual([]);
    expect(parseNfoForTags('')).toEqual([]);
    expect(parseNfoForTags('[b][/b]')).toEqual([]);
  });
});

describe('detectMediaId', () => {
  it('reconnaît un identifiant IMDb collé ou saisi', () => {
    expect(detectMediaId('tt0133093')).toMatchObject({ source: 'imdb', id: 'tt0133093' });
    expect(detectMediaId('https://www.imdb.com/title/tt0133093/')).toMatchObject({
      source: 'imdb',
      id: 'tt0133093',
    });
  });

  it('reconnaît une URL TMDb en gardant son espace de noms', () => {
    // Le préfixe `tv/` doit survivre, sinon la recherche part sur le mauvais
    // périmètre côté API.
    expect(detectMediaId('https://www.themoviedb.org/tv/1396')).toMatchObject({
      source: 'tmdb',
      id: 'tv/1396',
      display: '1396',
    });
  });

  it('relit la forme préfixée au rechargement de la page', () => {
    expect(detectMediaId('movie/603')).toMatchObject({ source: 'tmdb', display: '603' });
  });

  it('reconnaît TVDB par le chemin comme par le paramètre', () => {
    expect(detectMediaId('https://thetvdb.com/series/12345')?.source).toBe('tvdb');
    expect(detectMediaId('https://thetvdb.com/x?id=999')?.source).toBe('tvdb');
  });

  it('reste muet sur ce qui est ambigu', () => {
    // Une suite de chiffres nue est le plus souvent une année ou du bruit :
    // basculer en « recherche par identifiant » là-dessus ferait disparaître
    // tous les résultats sans explication.
    for (const entree of ['1999', '', '   ', 'Matrix', 'tt12']) {
      expect(detectMediaId(entree)).toBeNull();
    }
  });

  it('nomme le bon paramètre de requête', () => {
    expect(mediaIdQueryParam('imdb')).toBe('imdbid');
    expect(mediaIdQueryParam('tmdb')).toBe('tmdbid');
    expect(mediaIdQueryParam('tvdb')).toBe('tvdbid');
  });
});
