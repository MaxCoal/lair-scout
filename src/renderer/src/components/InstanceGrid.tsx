import type { InstanceSnapshot } from '@shared/types'
import InstanceTile from './InstanceTile'

type Props = {
  instances: InstanceSnapshot[]
  url: string
  onFocus: (id: string) => void
  onGotoOne: (id: string) => void
}

export default function InstanceGrid({ instances, url, onFocus, onGotoOne }: Props) {
  return (
    <div className="grid">
      {instances.map((fox) => (
        <InstanceTile key={fox.id} fox={fox} url={url} onFocus={onFocus} onGotoOne={onGotoOne} />
      ))}
    </div>
  )
}
