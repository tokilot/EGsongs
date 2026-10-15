import { useCallback, useState } from 'react'
import * as api from '../api/client.ts'
import { usePlayer } from '../player/usePlayer.ts'
import { translate } from '../ui/i18n.ts'
import { useSong } from './useSong.ts'

/** Fired on window by the Ctrl+S shortcut. */
export const SAVE_EDITS_EVENT = 'tabs:save-edits'

/** Opening, saving, discarding and resetting tab edits for the open song. */
export function useTabEditing() {
  const { state, player } = usePlayer()
  const { song, replace, open, libraryChanged } = useSong()
  const [busy, setBusy] = useState(false)
  const editing = state.editing !== null

  const start = useCallback(() => player.startEditing(), [player])

  /** Stores the edited tab with the song (only when something changed) and closes the editor. */
  const save = useCallback(async () => {
    if (!song || !player.getSnapshot().editing) return
    if (!player.editDirty) {
      player.endEditing(false)
      return
    }
    const bytes = player.editedFile()
    if (!bytes) return
    setBusy(true)
    try {
      replace(await api.saveEditedSong(song.id, bytes))
      player.endEditing(true)
      libraryChanged()
    } catch (cause) {
      window.alert(translate('保存失败：{message}', { message: (cause as Error).message }))
    } finally {
      setBusy(false)
    }
  }, [song, player, replace, libraryChanged])

  /** Closes the editor and throws away what was changed since it was opened. */
  const discard = useCallback(() => {
    if (player.editDirty && !window.confirm(translate('放弃这次的全部修改吗？'))) return
    player.endEditing(false)
  }, [player])

  /** Deletes the saved edits and opens the tab as it was imported. */
  const restoreOriginal = useCallback(async () => {
    if (!song?.edited || !window.confirm(translate('删除保存过的修改，恢复成导入时的曲谱吗？'))) return
    setBusy(true)
    try {
      player.endEditing(false)
      replace(await api.discardEditedSong(song.id))
      libraryChanged()
      await open(song.id)
    } finally {
      setBusy(false)
    }
  }, [song, player, replace, open, libraryChanged])

  return { editing, busy, start, save, discard, restoreOriginal, canEdit: state.status === 'ready' && song !== null }
}
