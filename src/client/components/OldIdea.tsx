import type { Idea } from '../../types'
import type { IdeasActions, IdeasState } from '../hooks/useIdeas'
import { BackLink } from './BackLink'
import { IdeaCard } from './IdeaCard'
import { shownTitle } from './IdeaTitle'

// shortcut: the old IdeaCard stands in for the idea screen; Task 5 replaces this file.

function IdeaCardFor({ idea, state, open }: { idea: Idea; state: IdeasState & IdeasActions; open?: boolean }) {
  return (
    <IdeaCard
      idea={idea}
      forceOpen={open}
      step={state.status?.current?.ideaId === idea.id ? state.status.current.step : null}
      onPatch={(patch) => state.patch(idea.id, patch)}
      onRerun={() => state.rerun(idea.id)}
      onReact={state.react}
      onRefine={() => state.refine(idea.id)}
      onRemove={() => state.remove(idea.id)}
    />
  )
}

export function OldIdea({ idea, state }: { idea: Idea; state: IdeasState & IdeasActions }) {
  return (
    <div className="screen">
      <BackLink />
      <h1 tabIndex={-1}>{shownTitle(idea)}</h1>
      <IdeaCardFor idea={idea} state={state} open />
    </div>
  )
}
