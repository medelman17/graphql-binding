import {
  GraphQLSchema,
  GraphQLUnionType,
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLInputObjectType,
  GraphQLInputField,
  GraphQLField,
  isNonNullType,
  GraphQLInputType,
  GraphQLOutputType,
  GraphQLWrappingType,
  isListType,
  GraphQLNamedType,
  GraphQLScalarType,
  GraphQLEnumType,
  GraphQLFieldMap,
  printSchema,
} from 'graphql'
import { Generator } from './Generator'

export class TypescriptGenerator extends Generator {
  scalarMapping = {
    Int: 'number',
    String: 'string',
    ID: 'string | number',
    Float: 'number',
    Boolean: 'boolean',
    DateTime: 'Date | string',
  }

  graphqlRenderers = {
    GraphQLUnionType: (type: GraphQLUnionType): string => {
      return `${this.renderDescription(type.description)}export type ${
        type.name
      } = ${type
        .getTypes()
        .map(t => t.name)
        .join(' | ')}`
    },

    GraphQLObjectType: (
      type: GraphQLObjectType | GraphQLInputObjectType | GraphQLInterfaceType,
    ): string => this.renderInterfaceOrObject(type),

    GraphQLInterfaceType: (
      type: GraphQLObjectType | GraphQLInputObjectType | GraphQLInterfaceType,
    ): string => this.renderInterfaceOrObject(type),

    GraphQLInputObjectType: (
      type: GraphQLObjectType | GraphQLInputObjectType | GraphQLInterfaceType,
    ): string => {
      const fieldDefinition = Object.keys(type.getFields())
        .map(f => {
          const field = type.getFields()[f]
          return `  ${this.renderFieldName(field)}: ${this.renderInputFieldType(
            field.type,
          )}`
        })
        .join('\n')

      let interfaces: GraphQLInterfaceType[] = []
      if (type instanceof GraphQLObjectType) {
        interfaces = type.getInterfaces()
      }

      return this.renderInterfaceWrapper(
        type.name,
        type.description,
        interfaces,
        fieldDefinition,
      )
    },

    GraphQLScalarType: (type: GraphQLScalarType): string => {
      if (type.name === 'ID') {
        return this.graphqlRenderers.GraphQLIDType(type)
      }
      return `${
        type.description
          ? `/*
${type.description}
*/
`
          : ''
      }export type ${type.name} = ${this.scalarMapping[type.name] || 'string'}`
    },

    GraphQLIDType: (type: GraphQLScalarType): string => {
      return `${
        type.description
          ? `/*
${type.description}
*/
`
          : ''
      }export type ${type.name}_Input = ${this.scalarMapping[type.name] ||
        'string'}
export type ${type.name}_Output = string`
    },

    GraphQLEnumType: (type: GraphQLEnumType): string => {
      return `${this.renderDescription(type.description)}export type ${
        type.name
      } = ${type
        .getValues()
        .map(e => `  '${e.name}'`)
        .join(' |\n')}`
    },
  }
  constructor({
    schema,
    inputSchemaPath,
    outputBindingPath,
  }: {
    schema: GraphQLSchema
    inputSchemaPath: string
    outputBindingPath: string
  }) {
    super({ schema, inputSchemaPath, outputBindingPath })
  }
  render() {
    return this.compile`\
${this.renderImports()}

interface BindingInstance {
  query: ${this.renderQueries()}
  mutation: ${this.renderMutations()}
  subscription: ${this.renderSubscriptions()}
}

interface BindingConstructor<T> {
  new(...args): T
}

${this.renderExports()}

/**
 * Types
*/

${this.renderTypes()}

/**
 * Type Defs
*/

${this.renderTypedefs()}`
  }
  renderExports() {
    return `export const Binding = makeBinding<BindingConstructor<BindingInstance>>({schema})`
  }
  renderQueries() {
    const queryType = this.schema.getQueryType()
    if (!queryType) {
      return '{}'
    }
    return this.renderMainMethodFields('query', queryType.getFields())
  }
  renderMutations() {
    const mutationType = this.schema.getMutationType()
    if (!mutationType) {
      return '{}'
    }
    return this.renderMainMethodFields('mutation', mutationType.getFields())
  }
  renderSubscriptions() {
    const subscriptionType = this.schema.getSubscriptionType()
    if (!subscriptionType) {
      return '{}'
    }
    return this.renderMainMethodFields(
      'subscription',
      subscriptionType.getFields(),
    )
  }
  getTypeNames() {
    const ast = this.schema
    // Create types
    return Object.keys(ast.getTypeMap())
      .filter(typeName => !typeName.startsWith('__'))
      .filter(typeName => typeName !== (ast.getQueryType() as any).name)
      .filter(
        typeName =>
          ast.getMutationType()
            ? typeName !== (ast.getMutationType()! as any).name
            : true,
      )
      .filter(
        typeName =>
          ast.getSubscriptionType()
            ? typeName !== (ast.getSubscriptionType()! as any).name
            : true,
      )
      .sort(
        (a, b) =>
          (ast.getType(a) as any).constructor.name <
          (ast.getType(b) as any).constructor.name
            ? -1
            : 1,
      )
  }
  renderTypes() {
    const typeNames = this.getTypeNames()
    return typeNames
      .map(typeName => {
        const type = this.schema.getTypeMap()[typeName]
        return this.graphqlRenderers[type.constructor.name]
          ? this.graphqlRenderers[type.constructor.name](type)
          : null
      })
      .join('\n\n')
  }
  renderTypedefs() {
    return (
      'const typeDefs = `' + printSchema(this.schema).replace(/`/g, '\\`') + '`'
    )
  }

  renderMainMethodFields(
    operation: string,
    fields: GraphQLFieldMap<any, any>,
  ): string {
    const methods = Object.keys(fields)
      .map(f => {
        const field = fields[f]
        return `    ${
          field.name
        }: (args, info, context) => Promise<${this.renderFieldType(
          field.type,
        )}${!isNonNullType(field.type) ? ' | null' : ''}> `
      })
      .join(',\n')

    return `{\n${methods}\n  }`
  }

  renderMainSubscriptionMethodFields(
    fields: GraphQLFieldMap<any, any>,
  ): string {
    return Object.keys(fields)
      .map(f => {
        const field = fields[f]
        return `    ${
          field.name
        }: (args, infoOrQuery, context): Promise<AsyncIterator<${this.renderFieldType(
          field.type,
        )}>> => super.delegateSubscription('${
          field.name
        }', args, infoOrQuery, context)`
      })
      .join(',\n')
  }

  renderInterfaceOrObject(
    type: GraphQLObjectType | GraphQLInputObjectType | GraphQLInterfaceType,
  ): string {
    const fieldDefinition = Object.keys(type.getFields())
      .map(f => {
        const field = type.getFields()[f]
        return `  ${this.renderFieldName(field)}: ${this.renderFieldType(
          field.type,
        )}`
      })
      .join('\n')

    let interfaces: GraphQLInterfaceType[] = []
    if (type instanceof GraphQLObjectType) {
      interfaces = type.getInterfaces()
    }

    return this.renderInterfaceWrapper(
      type.name,
      type.description,
      interfaces,
      fieldDefinition,
    )
  }

  renderFieldName(field: GraphQLInputField | GraphQLField<any, any>) {
    return `${field.name}${isNonNullType(field.type) ? '' : '?'}`
  }

  renderFieldType(type: GraphQLInputType | GraphQLOutputType) {
    if (isNonNullType(type)) {
      return this.renderFieldType((type as GraphQLWrappingType).ofType)
    }
    if (isListType(type)) {
      return `${this.renderFieldType((type as GraphQLWrappingType).ofType)}[]`
    }
    return `${(type as GraphQLNamedType).name}${
      (type as GraphQLNamedType).name === 'ID' ? '_Output' : ''
    }`
  }

  renderInputFieldType(type: GraphQLInputType | GraphQLOutputType) {
    if (isNonNullType(type)) {
      return this.renderInputFieldType((type as GraphQLWrappingType).ofType)
    }
    if (isListType(type)) {
      const inputType = this.renderInputFieldType(
        (type as GraphQLWrappingType).ofType,
      )
      return `${inputType}[] | ${inputType}`
    }
    return `${(type as GraphQLNamedType).name}${
      (type as GraphQLNamedType).name === 'ID' ? '_Input' : ''
    }`
  }

  renderTypeWrapper(
    typeName: string,
    typeDescription: string | void,
    fieldDefinition: string,
  ): string {
    return `${this.renderDescription(
      typeDescription,
    )}export type ${typeName} = {
${fieldDefinition}
}`
  }

  renderInterfaceWrapper(
    typeName: string,
    typeDescription: string | void,
    interfaces: GraphQLInterfaceType[],
    fieldDefinition: string,
  ): string {
    return `${this.renderDescription(
      typeDescription,
    )}export interface ${typeName}${
      interfaces.length > 0
        ? ` extends ${interfaces.map(i => i.name).join(', ')}`
        : ''
    } {
${fieldDefinition}
}`
  }

  renderDescription(description?: string | void) {
    return `${
      description
        ? `/*
${description.split('\n').map(l => ` * ${l}\n`)}
 */
`
        : ''
    }`
  }
}