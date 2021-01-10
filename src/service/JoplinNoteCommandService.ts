import { FolderOrNote, JoplinListNote } from '../model/FolderOrNote'
import * as vscode from 'vscode'
import { QuickPickItem, TreeView } from 'vscode'
import {
  config,
  noteActionApi,
  noteApi,
  noteExtApi,
  PageUtil,
  resourceApi,
  searchApi,
  tagApi,
  TypeEnum,
} from 'joplin-api'
import { NoteListProvider } from '../model/NoteProvider'
import { FolderOrNoteExtendsApi } from '../api/FolderOrNoteExtendsApi'
import { appConfig, AppConfig } from '../config/AppConfig'
import { JoplinNoteUtil } from '../util/JoplinNoteUtil'
import { globalState } from '../state/GlobalState'
import * as path from 'path'
import { mkdirp, pathExists, remove } from 'fs-extra'
import { createEmptyFile } from '../util/createEmptyFile'
import { UploadResourceUtil } from '../util/UploadResourceUtil'
import { uploadResourceService } from './UploadResourceService'
import { difference } from 'lodash'
import { TagGetRes } from 'joplin-api/dist/modal/TagGetRes'
import { i18nLoader } from '../util/constant'
import { HandlerService } from './HandlerService'
import { wait } from '../util/wait'
import { ResourceGetRes } from 'joplin-api/dist/modal/ResourceGetRes'

export class JoplinNoteCommandService {
  private folderOrNoteExtendsApi = new FolderOrNoteExtendsApi()
  public handlerService!: HandlerService

  constructor(
    private config: {
      noteViewProvider: NoteListProvider
      noteListTreeView: TreeView<FolderOrNote>
    },
  ) {}

  init(appConfig: AppConfig) {
    if (!appConfig.token) {
      return
    }
    config.token = appConfig.token
    config.port = appConfig.port

    setInterval(async () => {
      await this.config.noteViewProvider.refresh()
    }, 1000 * 10)
  }

  /**
   * create folder or note
   * @param type
   * @param item
   */
  async create(
    type: TypeEnum,
    item: FolderOrNote = this.config.noteListTreeView.selection[0],
  ) {
    const parentFolderId = !item
      ? ''
      : item.item.type_ === TypeEnum.Folder
      ? item.item.id
      : item.item.parent_id
    console.log('joplinNote.create: ', item, parentFolderId)

    const title = await vscode.window.showInputBox({
      placeHolder: i18nLoader.get(
        'Please enter what you want to create {{type}} name',
        {
          type: i18nLoader.get(type === TypeEnum.Folder ? 'folder' : 'note'),
        },
      ),
    })
    if (!title) {
      return
    }

    const { id } = await this.folderOrNoteExtendsApi.create({
      title,
      parent_id: parentFolderId,
      type_: type,
    })
    await this.config.noteViewProvider.refresh()
    if (type === TypeEnum.Note) {
      await noteActionApi.openAndWatch(id)
    }
  }

  /**
   * remove folder or note
   * @param item
   */
  async remove(item: FolderOrNote = this.config.noteListTreeView.selection[0]) {
    console.log('joplinNote.remove: ', item)
    const folderOrNote = item.item
    if (appConfig.deleteConfirm) {
      const confirmMsg = i18nLoader.get('confirm')
      const cancelMsg = i18nLoader.get('cancel')
      const res = await vscode.window.showQuickPick([confirmMsg, cancelMsg], {
        placeHolder: i18nLoader.get('delete or not {{type}} [{{title}}]', {
          type: i18nLoader.get(
            folderOrNote.type_ === TypeEnum.Folder
              ? 'folder'
              : (folderOrNote as JoplinListNote).is_todo
              ? 'todo'
              : 'note',
          ),
          title: folderOrNote.title,
        }),
      })
      console.log(res)
      if (res !== confirmMsg) {
        return
      }
    }

    await this.folderOrNoteExtendsApi.remove(item.item)
    await this.config.noteViewProvider.refresh()
  }

  async rename(item: FolderOrNote = this.config.noteListTreeView.selection[0]) {
    console.log('joplinNote.rename: ', item)
    const title = await vscode.window.showInputBox({
      placeHolder: i18nLoader.get('Please enter a new name'),
      value: item.item.title,
    })
    if (!title) {
      return
    }
    await this.folderOrNoteExtendsApi.rename({
      id: item.item.id,
      title,
      type_: item.item.type_,
    })
    await this.config.noteViewProvider.refresh()
  }

  async copyLink(
    item: FolderOrNote = this.config.noteListTreeView.selection[0],
  ) {
    console.log('joplinNote.copyLink: ', item)
    const label = JoplinNoteUtil.trimTitleStart(item.label!)
    const url = `[${label}](:/${item.id})`
    vscode.env.clipboard.writeText(url)
  }

  async toggleTodoState(
    item: FolderOrNote = this.config.noteListTreeView.selection[0],
  ) {
    await noteExtApi.toggleTodo(item.id)
    await this.config.noteViewProvider.refresh()
  }

  /**
   * open note in vscode
   * @param item
   */
  async openNote(item: Omit<FolderOrNote, 'item'> & { item: JoplinListNote }) {
    await noteActionApi.openAndWatch(item.id)
    console.log('openNote: ', item.id, await noteActionApi.isWatch(item.id))
    const interval = setInterval(() => {
      this.config.noteListTreeView.reveal(item, {
        select: true,
        focus: true,
      })
    }, 17)
    await new Promise((resolve) =>
      setTimeout(() => resolve(clearInterval(interval)), 500),
    )
  }

  /**
   * show search input box
   */
  async search() {
    interface SearchNoteItem extends QuickPickItem {
      noteId: string
    }

    const searchQuickPickBox = vscode.window.createQuickPick<SearchNoteItem>()
    searchQuickPickBox.placeholder = i18nLoader.get('Please enter key words')
    searchQuickPickBox.canSelectMany = false
    searchQuickPickBox.items = await this.loadLastNoteList()

    searchQuickPickBox.onDidChangeValue(async (value: string) => {
      if (value.trim() === '') {
        searchQuickPickBox.items = await this.loadLastNoteList()
        return
      }
      const { items: noteList } = await searchApi.search({
        query: value,
        type: TypeEnum.Note,
        fields: ['id', 'title'],
        limit: 100,
        order_by: 'user_updated_time',
        order_dir: 'DESC',
      })
      searchQuickPickBox.items = noteList.map((note) => ({
        label: note.title,
        noteId: note.id,
        alwaysShow: true,
      }))
      console.log('search: ', value, JSON.stringify(searchQuickPickBox.items))
    })
    searchQuickPickBox.onDidAccept(() => {
      const selectItem = searchQuickPickBox.selectedItems[0]
      noteActionApi.openAndWatch(selectItem.noteId)
    })
    searchQuickPickBox.show()
  }

  private readonly LastLimitCount = 20

  /**
   * 加载最后编辑的一些笔记
   * @private
   */
  private async loadLastNoteList() {
    return (
      await noteApi.list({
        fields: ['id', 'title'],
        limit: this.LastLimitCount,
        order_dir: 'DESC',
        order_by: 'user_updated_time',
      })
    ).items.map((item) => ({
      label: item.title,
      noteId: item.id,
      alwaysShow: true,
    }))
  }

  /**
   * 切换选中的文件时自动展开左侧的树
   * @param fileName
   */
  async onDidChangeActiveTextEditor(fileName?: string) {
    if (!this.config.noteListTreeView.visible) {
      return
    }
    const noteId = JoplinNoteUtil.getNoteIdByFileName(fileName)
    if (!noteId) {
      return
    }
    await Promise.all([this.focus(noteId), this.refreshResource(noteId)])
  }

  private async refreshResource(noteId: string) {
    console.log('refreshResource: ', noteId, this.config)
  }

  private async focus(noteId: string) {
    const note = await noteApi.get(noteId, [
      'id',
      'parent_id',
      'title',
      'is_todo',
      'todo_completed',
    ])
    this.config.noteListTreeView.reveal(
      new FolderOrNote({
        ...note,
        type_: TypeEnum.Note,
      }),
    )
  }

  /**
   * 创建资源
   */
  async createResource() {
    const globalStoragePath = globalState.context.globalStoragePath
    const title = await vscode.window.showInputBox({
      placeHolder: i18nLoader.get(
        'Please enter what you want to create {{type}} name',
        {
          type: i18nLoader.get('attachment'),
        },
      ),
      value: '',
    })
    if (!title) {
      return
    }
    const filePath = path.resolve(globalStoragePath, `tempResource/${title}`)
    const dir = path.dirname(filePath)
    if (!(await pathExists(dir))) {
      await mkdirp(dir)
    }
    await createEmptyFile(filePath)
    const { res, markdownLink } = await UploadResourceUtil.uploadFileByPath(
      filePath,
    )
    await uploadResourceService.insertUrlByActiveEditor(markdownLink)
    if (await pathExists(filePath)) {
      await remove(filePath)
    }
    vscode.window.showInformationMessage(
      i18nLoader.get('Attachment resource created successfully'),
    )
    await this.handlerService.openResource(res.id)
  }

  /**
   * 删除附件
   */
  async removeResource() {
    const list = (
      await PageUtil.pageToAllList(resourceApi.list, {
        order_by: 'user_updated_time',
        order_dir: 'DESC',
      })
    ).map(
      (item) =>
        ({
          label: item.title,
          id: item.id,
        } as vscode.QuickPickItem & { id: string }),
    )
    const selectItemList = await vscode.window.showQuickPick(list, {
      canPickMany: true,
      placeHolder: '请选择要删除的附件资源',
    })
    if (!selectItemList || selectItemList.length === 0) {
      return
    }
    await Promise.all(
      selectItemList.map(async (item) => resourceApi.remove(item.id)),
    )
    vscode.window.showInformationMessage(
      selectItemList.map((item) => item.label).join('\n'),
      {
        title: '删除附件成功',
      },
    )
  }

  /**
   * 管理标签
   * 有两种模式
   * 1. 在笔记侧边栏
   * 2. 在笔记编辑器中
   * @param item
   */
  async manageTags(
    item?: Omit<FolderOrNote, 'item'> & { item: JoplinListNote },
  ) {
    const noteId =
      item?.id ||
      JoplinNoteUtil.getNoteIdByFileName(
        vscode.window.activeTextEditor?.document.fileName,
      )
    if (!noteId) {
      return
    }
    const oldSelectIdList = (await noteApi.tagsById(noteId)).map(
      (tag) => tag.id,
    )
    const selectTagSet = new Set(oldSelectIdList)
    const items = (await PageUtil.pageToAllList(tagApi.list)).map(
      (tag) =>
        ({
          label: tag.title,
          picked: selectTagSet.has(tag.id),
          tag,
        } as vscode.QuickPickItem & { tag: TagGetRes }),
    )

    const selectItems = await vscode.window.showQuickPick(items, {
      placeHolder: i18nLoader.get('Please select a tag for this note'),
      canPickMany: true,
    })
    if (!selectItems) {
      return
    }
    const selectIdList = selectItems.map((item) => item.tag.id)
    const addIdList = difference(selectIdList, oldSelectIdList)
    const deleteIdList = difference(oldSelectIdList, selectIdList)
    console.log('选择项: ', selectItems, addIdList, deleteIdList)
    await Promise.all(addIdList.map((id) => tagApi.addTagByNoteId(id, noteId)))
    await Promise.all(
      deleteIdList.map((id) => tagApi.removeTagByNoteId(id, noteId)),
    )
  }

  async createTag() {
    const title = await vscode.window.showInputBox({
      placeHolder: i18nLoader.get('Please enter the name of the new tag'),
    })
    if (!title) {
      return
    }
    await tagApi.create({
      title,
    })
    vscode.window.showInformationMessage(
      i18nLoader.get('Create tag [{{title}}] success', {
        title,
      }),
    )
  }

  async removeTag() {
    const items = (await PageUtil.pageToAllList(tagApi.list)).map(
      (tag) =>
        ({
          label: tag.title,
          tag,
        } as vscode.QuickPickItem & { tag: TagGetRes }),
    )
    const selectItem = await vscode.window.showQuickPick(items, {
      placeHolder: i18nLoader.get('Please select the tag to delete'),
    })
    if (!selectItem) {
      return
    }
    await tagApi.remove(selectItem.tag.id)
    vscode.window.showInformationMessage(
      i18nLoader.get('Remove tag [{{title}}] success', {
        title: selectItem.tag.title,
      }),
    )
  }
}
