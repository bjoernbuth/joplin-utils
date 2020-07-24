import axios from 'axios'
import { NoteGetRes } from '../modal/NoteGetRes'
import { NoteProperties } from '../modal/NoteProperties'
import { ApiUtil } from '../util/ApiUtil'
import { TagGetRes } from '../modal/TagGetRes'
import { NoteCreateRes } from '../modal/NoteCreateRes'
import { NoteUpdateRes } from '../modal/NoteUpdateRes'
import { ResourceGetRes } from '../modal/ResourceGetRes'
import { RequiredField } from 'liuli-types'

class NoteApi {
  async list(): Promise<NoteGetRes[]>
  async list<K extends keyof NoteProperties>(
    fields?: K[],
  ): Promise<Pick<NoteProperties, K>[]>
  async list(fields?: (keyof NoteProperties)[]) {
    const res = await axios.get<NoteGetRes[]>(
      ApiUtil.baseUrl('/notes', { fields }),
    )
    return res.data
  }
  async get(id: string): Promise<NoteGetRes>
  async get<K extends keyof NoteProperties>(
    id: string,
    fields?: K[],
  ): Promise<Pick<NoteProperties, K>>
  async get(id: string, fields?: (keyof NoteProperties)[]) {
    const res = await axios.get<NoteGetRes>(
      ApiUtil.baseUrl(`/notes/${id}`, { fields }),
    )
    return res.data
  }
  async create(param: RequiredField<Partial<NoteProperties>, 'title'>) {
    const res = await axios.post<NoteCreateRes>(
      ApiUtil.baseUrl(`/notes`),
      param,
    )
    return res.data
  }
  async update(param: RequiredField<Partial<NoteProperties>, 'id'>) {
    const { id, ...others } = param
    const res = await axios.put<NoteUpdateRes>(
      ApiUtil.baseUrl(`/notes/${id}`),
      others,
    )
    return res.data
  }

  /**
   * @param id
   * @throws Error: Request failed with status code 404
   */
  async remove(id: string) {
    const res = await axios.delete(ApiUtil.baseUrl(`/notes/${id}`))
    return res.data
  }
  async tagsById(id: string) {
    const res = await axios.get<TagGetRes[]>(
      ApiUtil.baseUrl(`/notes/${id}/tags`),
    )
    return res.data
  }
  async resourcesById(id: string) {
    const res = await axios.get<ResourceGetRes[]>(
      ApiUtil.baseUrl(`/notes/${id}/resources`),
    )
    return res.data
  }
}

export const noteApi = new NoteApi()
