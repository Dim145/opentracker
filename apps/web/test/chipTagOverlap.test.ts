import { describe, expect, it } from 'vitest';
import {
  chipAtoms,
  tagForChip,
  tagsBeyondChips,
} from '../app/utils/chipTagOverlap';
import { releaseChips } from '../app/utils/releaseChips';

/**
 * Ce que le filtre doit garder, et surtout ce qu'il ne doit PAS manger.
 *
 * La logique est du jugement — décider que deux mots désignent le même fait —
 * et un jugement non testé dérive. Les cas ci-dessous viennent tous du
 * catalogue de test réel, pas d'une invention : `x264` contre `AVC` neuf fois,
 * `AAC` onze fois, `MULTI` là où la pastille dit autre chose.
 */

const tag = (name: string) => ({ name, slug: name.toLowerCase(), id: name });

describe('tagsBeyondChips', () => {
  const nom =
    'Sousou.no.Frieren.S01E09.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-TsundereRaws';

  it('retire ce que la pastille dit mot pour mot', () => {
    const reste = tagsBeyondChips(nom, [tag('1080p'), tag('WEB-DL'), tag('VOSTFR')]);
    expect(reste).toEqual([]);
  });

  it('retire l’encodeur quand la pastille affiche sa norme', () => {
    // La pastille dit `AVC` ; le tag dit `x264`. Même fait.
    expect(releaseChips(nom).codec).toBe('AVC');
    expect(tagsBeyondChips(nom, [tag('x264')])).toEqual([]);
    expect(tagsBeyondChips(nom, [tag('x265')]).map((t) => t.name)).toEqual(['x265']);
  });

  it('retire le codec audio maintenant que la pastille le compose', () => {
    // `AAC 2.0` en une fente : le tag `AAC` comme le tag `2.0` sont couverts.
    expect(releaseChips(nom).audio).toBe('AAC 2.0');
    expect(tagsBeyondChips(nom, [tag('AAC'), tag('2.0')])).toEqual([]);
  });

  it('GARDE ce qu’aucune pastille ne dit', () => {
    const reste = tagsBeyondChips(nom, [tag('anime'), tag('saison-complete')]);
    expect(reste.map((t) => t.name)).toEqual(['anime', 'saison-complete']);
  });

  it('ne confond pas deux langues qui ne disent pas la même chose', () => {
    // La pastille dit `VOSTFR` — des sous-titres. `MULTI` dit plusieurs pistes
    // AUDIO. Les rapprocher parce qu'ils occupent la même fente ferait
    // disparaître une information réelle.
    expect(tagsBeyondChips(nom, [tag('MULTI')]).map((t) => t.name)).toEqual(['MULTI']);
  });

  it('couvre chaque moitié d’une langue composée', () => {
    const multi = 'Cats.Eye.S01.MULTi.VFF.1080p.BluRay.x264-KAZETV';
    expect(releaseChips(multi).language).toBe('MULTI.VFF');
    expect(tagsBeyondChips(multi, [tag('MULTI'), tag('VFF')])).toEqual([]);
  });

  it('rend tout quand il n’y a pas de nom à analyser', () => {
    expect(tagsBeyondChips(null, [tag('1080p')]).map((t) => t.name)).toEqual(['1080p']);
    expect(tagsBeyondChips('', [tag('1080p')]).map((t) => t.name)).toEqual(['1080p']);
  });

  it('rend une liste vide plutôt que `null`', () => {
    expect(tagsBeyondChips('x', null)).toEqual([]);
    expect(tagsBeyondChips('x', [])).toEqual([]);
  });
});

describe('chipAtoms', () => {
  it('ne découpe pas les canaux sur le point', () => {
    // `2.0` découpé donnerait les atomes `2` et `0`, qui rendraient redondant
    // n'importe quel tag nommé « 2 ».
    const atoms = chipAtoms(
      releaseChips('X.1080p.WEB-DL.AAC.2.0.H.264-GRP'),
    );
    expect(atoms.has('2.0')).toBe(true);
    expect(atoms.has('0')).toBe(false);
  });
});

describe('tagForChip', () => {
  const tags = [tag('WEB-DL'), tag('x264'), tag('AAC')];

  it('relie une pastille au tag de même nom', () => {
    expect(tagForChip('WEB-DL', tags)?.slug).toBe('web-dl');
  });

  it('relie une pastille au tag qui la nomme autrement', () => {
    expect(tagForChip('AVC', tags)?.name).toBe('x264');
  });

  it('relie chaque moitié d’une pastille composée', () => {
    expect(tagForChip('AAC 2.0', tags)?.name).toBe('AAC');
  });

  it('ne fabrique pas de lien quand aucun tag ne correspond', () => {
    expect(tagForChip('2160p', tags)).toBeNull();
    expect(tagForChip(null, tags)).toBeNull();
    expect(tagForChip('WEB-DL', [])).toBeNull();
  });
});

describe('les codecs voisins ne sont pas confondus', () => {
  it('ne replie pas DivX ni XviD sur AVC', () => {
    // MPEG-4 ASP, pas H.264 : avec l'alias, une étiquette XviD posée à la main
    // était reliée à une pastille AVC lue dans le nom, donc masquée comme
    // « redondante » alors qu'elle dit autre chose.
    const tags = [tag('XviD'), tag('x264')];
    expect(tagForChip('AVC', tags)?.name).toBe('x264');
    expect(tagForChip('XviD', tags)?.name).toBe('XviD');
    // Une pastille AVC ne doit plus revendiquer l'étiquette XviD.
    expect(tagForChip('AVC', [tag('XviD')])).toBeNull();
    expect(tagForChip('AVC', [tag('DivX')])).toBeNull();
  });
});
