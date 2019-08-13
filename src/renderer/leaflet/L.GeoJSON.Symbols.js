/*
  CAUTION: This module must not be imported from different modules.
*/

import L from 'leaflet'
import ms from 'milsymbol'
import { K } from '../../shared/combinators'
import selection from '../components/App.selection'
import evented from '../evented'
import { fromNow } from '../../shared/datetime'
import vectorFactories from './vector-factories'

const MODIFIER_MAP = {
  f: 'reinforcedReduced',
  m: 'higherFormation',
  q: 'direction',
  t: 'uniqueDesignation',

  // w: 'dtg',
  z: 'speed'
}

const defaultOptions = {

  // symbol size derived from feature or global settings.
  size: _ => 34,
  selectable: false
}

const modifiers = feature => Object.entries(feature.properties)
  .filter(([key, value]) => MODIFIER_MAP[key] && value)
  .map(([key, value]) => ([key, key === 'w' ? fromNow(value) : value]))
  .reduce((acc, [key, value]) => K(acc)(acc => (acc[MODIFIER_MAP[key]] = value)), {})

const onEachFeature = function (feature, layer) {
  const { id, actions } = feature
  this.layers[this.key(id)] = layer
  if (!actions || !actions.update) return

  // Manually add tools interface for now.
  layer.tools = {}

  const latlngs = coordinates => coordinates.map(ring => ring.map(([lng, lat]) => L.latLng(lat, lng)))
  const latlng = coordinates => L.latLng(coordinates[1], coordinates[0])

  layer.on('tools:edit', event => {
    const { geometry } = event
    switch (geometry.type) {
      case 'Polygon': return actions.update(latlngs(geometry.coordinates))
      case 'Point': return actions.update(latlng(geometry.coordinates))
    }
  })

  layer.on('click', () => this.select(id))

  const ctrlKey = event => event.originalEvent.ctrlKey
  const set = (slot, message) => event => ctrlKey(event) && evented.emit('OSD_MESSAGE', { slot, message })
  const reset = slot => () => evented.emit('OSD_MESSAGE', { slot, message: '' })

  if (feature.title) {
    layer.on('mouseover', set('B1', feature.title))
    layer.on('mouseout', reset('B1'))
  }

  if (feature.properties.w) {
    layer.on('mouseover', set('B2', fromNow(feature.properties.w)))
    layer.on('mouseout', reset('B2'))
  }
}

const pointToLayer = function (feature, latlng) {
  const { id, properties } = feature
  const { sidc } = properties

  const icon = symbol => L.divIcon({
    className: '',
    html: symbol.asSVG(),
    iconAnchor: new L.Point(symbol.getAnchor().x, symbol.getAnchor().y)
  })

  const symbolOptions = {
    size: this.options.size(),
    colorMode: 'Light', // default: light
    simpleStatusModifier: true,
    ...modifiers(feature)
  }

  const icons = {
    standard: icon(new ms.Symbol(sidc, symbolOptions)),
    highlighted: icon(new ms.Symbol(sidc, {
      ...symbolOptions,
      monoColor: 'white',
      outlineColor: 'black',
      outlineWidth: 6
    }))
  }

  const markerOptions = {
    id, // feature identifier
    icons,
    draggable: false,
    keyboard: false, // default: true
    autoPan: true,
    autoPanSpeed: 10 // default: 10
  }

  return K(L.marker(latlng, markerOptions))(marker => {
    const icon = selection.selected()
      .find(selection => selection && selection.key === this.key(id))
      ? marker.options.icons.highlighted
      : marker.options.icons.standard

    marker.setIcon(icon)
  })
}

const key = function (id) {
  return `feature://${this.options.id}/${id}`
}

const initialize = function (features, options) {
  this.layers = []
  L.setOptions(this, options)
  options.pointToLayer = pointToLayer.bind(this)
  options.onEachFeature = onEachFeature.bind(this)
  L.GeoJSON.prototype.initialize.call(this, features, options)

  const onSelected = object => this.selected(object)
  const onDeselected = object => this.deselected(object)

  this.once('remove', () => {
    selection.off('selected', onSelected)
    selection.off('deselected', onDeselected)
  })

  selection.on('selected', onSelected)
  selection.on('deselected', onDeselected)
}

const select = function (id) {
  const [selected] = selection.selected()
  if (selected && selected.key === this.key(id)) return
  const marker = this.layers[this.key(id)]
  if (!marker) return

  const { actions } = marker.feature
  selection.select({ key: this.key(id), ...actions })
}

const selected = function ({ key }) {
  const layer = this.layers[key]
  if (!layer) return
  if (layer.options.icons) layer.setIcon(layer.options.icons.highlighted)
  this._map.tools.edit(layer)
}

const deselected = function ({ key }) {
  const marker = this.layers[key]
  if (!marker) return
  if (!marker.options.icons) return
  marker.setIcon(marker.options.icons.standard)
}

const addFeature = function (feature) {
  this.addData(feature)
  this.select(feature.id)
}

const removeFeature = function (id) {
  const marker = this.layers[this.key(id)]
  if (!marker) return
  selection.deselect()
  this.removeLayer(marker)
  delete this.layers[this.key(id)]
}

const replaceFeature = function (id, feature) {
  const layer = this.layers[this.key(id)]
  if (!layer) return

  this.removeLayer(layer)
  delete this.layers[this.key(id)]
  this.addData(feature)

  // TODO: keep editing if already selected
}

const moveFeature = function (id, lat, lng) {
  const marker = this.layers[this.key(id)]
  if (!marker) return
  if (marker.getLatLng().equals(L.latLng(lat, lng))) return
  marker.setLatLng(L.latLng(lat, lng))
}

const geometryToLayer = function (geojson, options) {
  // Either we find a SIDC/function specific layer factory or
  // we use generic Leaflet method.
  const { sidc } = geojson.properties
  const functionId = sidc ? sidc.substring(4, 10) : '------'
  const factory = vectorFactories[functionId] || L.GeoJSON.geometryToLayer

  if (typeof factory !== 'function') return
  return factory(geojson, options)
}

/**
 * Hook-in to provide own function geometryToLayer().
 */
const addData = function (geojson) {

  const features = L.Util.isArray(geojson) ? geojson : geojson.features

  if (features) {
    // When collection, add individual features recursively and return.
    features
      .filter(feature => feature.geometries || feature.geometry || feature.features || feature.coordinates)
      .forEach(feature => this.addData(feature))
    return this
  }

  const options = this.options
  if (options.filter && !options.filter(geojson)) return this
  const layer = geometryToLayer(geojson, options)
  if (!layer) return this

  layer.feature = L.GeoJSON.asFeature(geojson)
  layer.defaultOptions = layer.options
  this.resetStyle(layer)

  if (options.onEachFeature) options.onEachFeature(geojson, layer)
  return this.addLayer(layer)
}

L.GeoJSON.Symbols = L.GeoJSON.extend({
  options: defaultOptions,
  key,
  initialize,
  select,
  selected,
  deselected,
  addFeature,
  removeFeature,
  replaceFeature,
  moveFeature,
  addData
})
