import type { InstanceSnapshot } from '@shared/types'
import InstanceTile from './InstanceTile'

type Props = {
  instances: InstanceSnapshot[]
  driveAll: boolean
  onFocus: (id: string) => void
  onGotoOne: (id: string) => void
}

export default function InstanceGrid({ instances, driveAll, onFocus, onGotoOne }: Props) {
  return (
    <div className="grid">
      {instances.map((fox) => (
        <InstanceTile
          key={fox.id}
          fox={fox}
          driveAll={driveAll}
          onFocus={onFocus}
          onGotoOne={onGotoOne}
        />
      ))}
    </div>
  )
}
