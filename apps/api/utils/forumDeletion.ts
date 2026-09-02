import { db, schema } from '@trackarr/db';
import { and, eq, ne, sql } from 'drizzle-orm';

/**
 * L'auteur d'un sujet peut-il encore le supprimer ?
 *
 * `forum_posts.topic_id` porte `onDelete: 'cascade'`, donc supprimer la ligne
 * `forum_topics` emporte TOUTES les réponses — y compris celles des autres
 * membres. Les deux chemins qui suppriment un sujet le savaient à moitié :
 *
 *   - `topics/[id].delete.ts` ne refusait que sur un sujet VERROUILLÉ ;
 *   - `posts/[id].delete.ts` porte un commentaire qui nomme le danger mot pour
 *     mot — « cascade-wipe the entire locked thread (every other user's
 *     replies too) » — et ne garde, lui aussi, que le cas verrouillé.
 *
 * Un fil non verrouillé de cinquante réponses restait donc destructible par son
 * seul auteur. Mesuré sur la pile compilée : un sujet portant trois messages de
 * trois auteurs distincts, supprimé par son auteur simple membre, laisse zéro
 * message. Le travail des deux autres disparaît sans recours et sans trace
 * autre qu'une ligne d'audit.
 *
 * La règle retenue est celle des forums : on peut retirer ce qu'on a ouvert
 * tant que personne d'autre n'y a pris la parole. Au-delà, le fil ne
 * t'appartient plus — seul le personnel peut le supprimer. Elle préserve le
 * retrait d'une bêtise fraîche sans donner à un auteur le pouvoir d'effacer
 * les contributions d'autrui.
 *
 * Le personnel n'est pas concerné : `isModerator` court-circuite l'appel.
 */
export async function assertTopicDeletableByAuthor(
  topicId: string,
  authorId: string
): Promise<void> {
  const [row] = await db
    .select({ others: sql<number>`count(*)::int` })
    .from(schema.forumPosts)
    .where(
      and(
        eq(schema.forumPosts.topicId, topicId),
        ne(schema.forumPosts.authorId, authorId)
      )
    );

  if ((row?.others ?? 0) > 0) {
    throw createError({
      statusCode: 403,
      // `data.reason` plutôt que la phrase : le front choisit sa traduction.
      data: { reason: 'topic-has-replies' },
      message:
        'Another member has replied in this topic. Only staff can delete it now.',
    });
  }
}
