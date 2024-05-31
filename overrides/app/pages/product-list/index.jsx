/*
 * Copyright (c) 2022, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import React, {useEffect, useState, useMemo} from 'react'
import PropTypes from 'prop-types'
import {useHistory, useLocation, useParams} from 'react-router-dom'
import {FormattedMessage, useIntl} from 'react-intl'
import {Helmet} from 'react-helmet'
import {
    useCategory,
    useCustomerId,
    useProductSearch,
    useShopperCustomersMutation
} from '@salesforce/commerce-sdk-react'
import {useServerContext} from '@salesforce/pwa-kit-react-sdk/ssr/universal/hooks'

// Components
import {
    Box,
    Flex,
    SimpleGrid,
    Grid,
    Select,
    Text,
    FormControl,
    Stack,
    useDisclosure,
    Button,
    Modal,
    ModalHeader,
    ModalBody,
    ModalFooter,
    ModalContent,
    ModalCloseButton,
    ModalOverlay
} from '@salesforce/retail-react-app/app/components/shared/ui'

// Project Components
import {HideOnDesktop} from '@salesforce/retail-react-app/app/components/responsive'
import EmptySearchResults from '@salesforce/retail-react-app/app/pages/product-list/partials/empty-results'
import PageHeader from './partials/page-header'

// Icons
import {FilterIcon} from '@salesforce/retail-react-app/app/components/icons'

// Hooks
import {
    useLimitUrls,
    usePageUrls,
    useSortUrls,
    useSearchParams
} from '@salesforce/retail-react-app/app/hooks'
import {useToast} from '@salesforce/retail-react-app/app/hooks/use-toast'
import useEinstein from '@salesforce/retail-react-app/app/hooks/use-einstein'

// Others
import {HTTPNotFound, HTTPError} from '@salesforce/pwa-kit-react-sdk/ssr/universal/errors'

// Constants
import {
    API_ERROR_MESSAGE,
    MAX_CACHE_AGE,
    TOAST_ACTION_VIEW_WISHLIST,
    TOAST_MESSAGE_ADDED_TO_WISHLIST,
    TOAST_MESSAGE_REMOVED_FROM_WISHLIST
} from '@salesforce/retail-react-app/app/constants'
import useNavigation from '@salesforce/retail-react-app/app/hooks/use-navigation'
import {useWishList} from '@salesforce/retail-react-app/app/hooks/use-wish-list'
import {getConfig} from '@salesforce/pwa-kit-runtime/utils/ssr-config'
import {useCurrency} from '@salesforce/retail-react-app/app/hooks'

// Algolia
import algoliasearch from 'algoliasearch/lite'
import {Configure, InstantSearch, Index, Hits} from 'react-instantsearch-hooks-web'
import ProductTile from '../../components/algolia-product-tile'
import AlgoliaHits from './partials/algolia-hits'
import AlgoliaCurrentRefinements from './partials/algolia-current-refinements'
import AlgoliaHierarchicalRefinements from './partials/algolia-hierarchical-refinements'
import AlgoliaColorRefinements from './partials/algolia-color-refinements'
import AlgoliaNoResultsBoundary from './partials/algolia-no-results-boundary'
import AlgoliaSizeRefinements from './partials/algolia-size-refinements'
import AlgoliaRangeRefinements from './partials/algolia-range-refinements'
import AlgoliaPagination from './partials/algolia-pagination'
import AlgoliaSortBy from './partials/algolia-sort-by'
import AlgoliaClearRefinements from './partials/algolia-clear-refinements'
import AlgoliaUiStateProvider from './partials/algolia-uistate-provider'
import SearchTabHeader from './partials/search-tab-header'
import { Tabs, TabPanels, TabPanel } from '@chakra-ui/react'

// NOTE: You can ignore certain refinements on a template level by updating the below
// list of ignored refinements.
const REFINEMENT_DISALLOW_LIST = ['c_isNew']

/*
 * This is a simple product listing page. It displays a paginated list
 * of product hit objects. Allowing for sorting and filtering based on the
 * allowable filters and sort refinements.
 */
const ProductList = (props) => {
    // Using destructuring to omit properties; we must rename `isLoading` because we use a different
    // `isLoading` later in this function.
    // eslint-disable-next-line react/prop-types, @typescript-eslint/no-unused-vars
    const {isLoading: _unusedIsLoading, staticContext, ...rest} = props
    const {isOpen, onOpen, onClose} = useDisclosure()
    const {formatMessage} = useIntl()
    const navigate = useNavigation()
    const history = useHistory()
    const params = useParams()
    const location = useLocation()
    const toast = useToast()
    const einstein = useEinstein()
    const {res} = useServerContext()
    const customerId = useCustomerId()
    const [searchParams, {stringify: stringifySearchParams}] = useSearchParams()
    const {currency: activeCurrency} = useCurrency()

    let {app: algoliaConfig} = useMemo(() => getConfig(), [])
    algoliaConfig = {
        ...algoliaConfig.algolia
    }

    // Algolia Settings
    const allIndices = [algoliaConfig.indices.primary, ...algoliaConfig.indices.replicas]
    const productIndexName = algoliaConfig.indices.primary.value
    const contentIndexName = algoliaConfig.indices.contents

    const searchClient = useMemo(() => {
        return algoliasearch(algoliaConfig.appId, algoliaConfig.apiKey)
    }, [])

    const hierarchicalCategoryAttributes = [
        `__primary_category.0`,
        `__primary_category.1`,
        `__primary_category.2`
    ]

    const currentRefinementAttributes = [
        'size',
        'color',
        'price.USD',
        '__primary_category.0'
    ]

    const filterEls = (
        <>
            <AlgoliaHierarchicalRefinements
                attributes={hierarchicalCategoryAttributes}
                title="Category"
            />
            <AlgoliaColorRefinements attribute="color" title="Color" />
            <AlgoliaSizeRefinements attribute="size" title="Size" />
            <AlgoliaRangeRefinements attribute="price.USD" title="Price" />
        </>
    )    

    /**************** Page State ****************/
    const [filtersLoading, setFiltersLoading] = useState(false)
    const [wishlistLoading, setWishlistLoading] = useState([])
    const [sortOpen, setSortOpen] = useState(false)

    const urlParams = new URLSearchParams(location.search)
    let searchQuery = urlParams.get('q')
    const isSearch = !!searchQuery

    if (params.categoryId) {
        searchParams._refine.push(`cgid=${params.categoryId}`)
    }

    /**************** Mutation Actions ****************/
    const {mutateAsync: createCustomerProductListItem} = useShopperCustomersMutation(
        'createCustomerProductListItem'
    )
    const {mutateAsync: deleteCustomerProductListItem} = useShopperCustomersMutation(
        'deleteCustomerProductListItem'
    )

    /**************** Query Actions ****************/
    const {
        isLoading,
        isRefetching,
        data: productSearchResult
    } = useProductSearch(
        {
            parameters: {
                ...searchParams,
                refine: searchParams._refine
            }
        },
        {
            keepPreviousData: true
        }
    )

    const {error, data: category} = useCategory(
        {
            parameters: {
                id: params.categoryId
            }
        },
        {
            enabled: !isSearch && !!params.categoryId
        }
    )

    // Apply disallow list to refinements.
    if (productSearchResult?.refinements) {
        productSearchResult.refinements = productSearchResult.refinements.filter(
            ({attributeId}) => !REFINEMENT_DISALLOW_LIST.includes(attributeId)
        )
    }

    /**************** Error Handling ****************/
    const errorStatus = error?.response?.status
    switch (errorStatus) {
        case undefined:
            // No Error.
            break
        case 404:
            throw new HTTPNotFound('Category Not Found.')
        default:
            throw new HTTPError(`HTTP Error ${errorStatus} occurred.`)
    }

    /**************** Response Handling ****************/
    if (res) {
        res.set('Cache-Control', `max-age=${MAX_CACHE_AGE}`)
    }

    // Reset scroll position when `isRefetching` becomes `true`.
    useEffect(() => {
        isRefetching && window.scrollTo(0, 0)
        setFiltersLoading(isRefetching)
    }, [isRefetching])

    const query = searchQuery ?? ''
    const filters = !isLoading && category?.id ? `categories.id:${category.id}` : ''

    /**************** Render Variables ****************/
    const basePath = `${location.pathname}${location.search}`
    const showNoResults = !isLoading && productSearchResult && !productSearchResult?.hits
    const {total, sortingOptions} = productSearchResult || {}
    const selectedSortingOptionLabel =
        sortingOptions?.find(
            (option) => option.id === productSearchResult?.selectedSortingOption
        ) ?? sortingOptions?.[0]

    // Get urls to be used for pagination, page size changes, and sorting.
    const pageUrls = usePageUrls({total})
    const sortUrls = useSortUrls({options: sortingOptions})
    const limitUrls = useLimitUrls()

    /**************** Action Handlers ****************/
    const {data: wishlist} = useWishList()
    const addItemToWishlist = async (product) => {
        setWishlistLoading([...wishlistLoading, product.productId])

        // TODO: This wishlist object is from an old API, we need to replace it with the new one.
        const listId = wishlist.id
        await createCustomerProductListItem(
            {
                parameters: {customerId, listId},
                body: {
                    quantity: 1,
                    public: false,
                    priority: 1,
                    type: 'product',
                    productId: product.productId
                }
            },
            {
                onError: () => {
                    toast({
                        title: formatMessage(API_ERROR_MESSAGE),
                        status: 'error'
                    })
                },
                onSuccess: () => {
                    toast({
                        title: formatMessage(TOAST_MESSAGE_ADDED_TO_WISHLIST, {quantity: 1}),
                        status: 'success',
                        action: (
                            // it would be better if we could use <Button as={Link}>
                            // but unfortunately the Link component is not compatible
                            // with Chakra Toast, since the ToastManager is rendered via portal
                            // and the toast doesn't have access to intl provider, which is a
                            // requirement of the Link component.
                            <Button variant="link" onClick={() => navigate('/account/wishlist')}>
                                {formatMessage(TOAST_ACTION_VIEW_WISHLIST)}
                            </Button>
                        )
                    })
                },
                onSettled: () => {
                    setWishlistLoading(wishlistLoading.filter((id) => id !== product.productId))
                }
            }
        )
    }

    const removeItemFromWishlist = async (product) => {
        setWishlistLoading([...wishlistLoading, product.productId])

        const listId = wishlist.id
        const itemId = wishlist.customerProductListItems.find(
            (i) => i.productId === product.productId
        ).id

        await deleteCustomerProductListItem(
            {
                body: {},
                parameters: {customerId, listId, itemId}
            },
            {
                onError: () => {
                    toast({
                        title: formatMessage(API_ERROR_MESSAGE),
                        status: 'error'
                    })
                },
                onSuccess: () => {
                    toast({
                        title: formatMessage(TOAST_MESSAGE_REMOVED_FROM_WISHLIST),
                        status: 'success'
                    })
                },
                onSettled: () => {
                    setWishlistLoading(wishlistLoading.filter((id) => id !== product.productId))
                }
            }
        )
    }

    // Clears all filters
    const resetFilters = () => {
        const newSearchParams = {
            ...searchParams,
            refine: []
        }
        const newPath = isSearch
            ? `/search?${stringifySearchParams(newSearchParams)}`
            : `/category/${params.categoryId}?${stringifySearchParams(newSearchParams)}`

        navigate(newPath)
    }

    /**************** Einstein ****************/
    useEffect(() => {
        if (productSearchResult) {
            isSearch
                ? einstein.sendViewSearch(searchQuery, productSearchResult)
                : einstein.sendViewCategory(category, productSearchResult)
        }
    }, [productSearchResult])

    return (
        <Box
            className="sf-product-list-page"
            data-testid="sf-product-list-page"
            layerStyle="page"
            paddingTop={{base: 6, lg: 8}}
            {...rest}
        >
            <Helmet>
                <title>{category?.pageTitle}</title>
                <meta name="description" content={category?.pageDescription} />
                <meta name="keywords" content={category?.pageKeywords} />
                <link
                    rel="stylesheet"
                    href="https://cdn.jsdelivr.net/npm/instantsearch.css@8.0.0/themes/reset-min.css"
                />
                <link
                    rel="stylesheet"
                    href="https://cdn.jsdelivr.net/npm/instantsearch.css@8.0.0/themes/satellite-min.css"
                />
                <link
                    rel="stylesheet"
                    href="https://cdn.jsdelivr.net/npm/@algolia/autocomplete-theme-classic"
                />
            </Helmet>
            <InstantSearch
                searchClient={searchClient}
                indexName={productIndexName}
                routing
                insights={true}
            >
                <Tabs>
                    {
                        isSearch &&
                        <SearchTabHeader isLoading={isLoading}/>
                    }
                    <TabPanels>
                        <TabPanel>
                            <Configure query={query} filters={filters} />
                            <AlgoliaNoResultsBoundary
                                fallback={<EmptySearchResults searchQuery={searchQuery} category={category} />}
                            >
                                <>
                                    {/* Header */}
                                    <Stack
                                        display={{base: 'none', lg: 'flex'}}
                                        direction="row"
                                        justify="flex-start"
                                        align="flex-start"
                                        spacing={6}
                                        marginBottom={6}
                                    >
                                        <Flex align="left" width="290px">
                                            <PageHeader
                                                category={category}
                                                isLoading={isLoading}
                                                searchQuery={searchQuery}
                                            />
                                        </Flex>
                                        <Flex flex={1} paddingTop={'45px'} alignItems="center" gap="3">
                                            <AlgoliaCurrentRefinements
                                                includedAttributes={currentRefinementAttributes}
                                            />
                                            <AlgoliaClearRefinements />
                                        </Flex>
                                        <Box paddingTop={'45px'}>
                                            <AlgoliaSortBy items={allIndices} />
                                        </Box>
                                    </Stack>

                                    <HideOnDesktop>
                                        <Stack spacing={6}>
                                            <PageHeader
                                                category={category}
                                                isLoading={isLoading}
                                                searchQuery={searchQuery}
                                            />
                                            <Stack
                                                display={{base: 'flex', md: 'none'}}
                                                direction="row"
                                                justify="flex-start"
                                                align="center"
                                                spacing={1}
                                                height={12}
                                                borderColor="gray.100"
                                            >
                                                <Flex align="center">
                                                    <Button
                                                        fontSize="sm"
                                                        colorScheme="black"
                                                        variant="outline"
                                                        marginRight={2}
                                                        display="inline-flex"
                                                        leftIcon={<FilterIcon boxSize={5} />}
                                                        onClick={onOpen}
                                                    >
                                                        <FormattedMessage
                                                            defaultMessage="Filter"
                                                            id="product_list.button.filter"
                                                        />
                                                    </Button>
                                                </Flex>
                                                <Flex align="center">
                                                    <AlgoliaSortBy items={allIndices} />
                                                </Flex>
                                            </Stack>
                                        </Stack>
                                        <Flex
                                            flex={1}
                                            paddingTop={4}
                                            marginBottom={4}
                                            alignItems="center"
                                            gap="3"
                                        >
                                            <AlgoliaCurrentRefinements
                                                includedAttributes={currentRefinementAttributes}
                                            />
                                            <AlgoliaClearRefinements />
                                        </Flex>
                                    </HideOnDesktop>

                                    {/* Body  */}
                                    <Grid templateColumns={{base: '1fr', md: '290px 1fr'}} columnGap={6}>
                                        <Stack
                                            display={{base: 'none', md: 'flex'}}
                                            spacing="6"
                                            direction="column"
                                        >
                                            {filterEls}
                                        </Stack>
                                        <Box>
                                            <SimpleGrid
                                                columns={[2, 2, 3, 3]}
                                                spacingX={4}
                                                spacingY={{base: 12, lg: 8}}
                                            >
                                                <AlgoliaHits
                                                    isLoading={isLoading}
                                                    hitComponent={({hit, sendEvent}) => {
                                                        const isInWishlist = false;

                                                        return (
                                                            <ProductTile
                                                                data-testid={`sf-product-tile-${hit.id}`}
                                                                key={hit.id}
                                                                product={hit}
                                                                enableFavourite={true}
                                                                isFavourite={isInWishlist}
                                                                currency={activeCurrency}
                                                                onClick={() => {
                                                                    sendEvent('click', hit, 'Product Clicked')

                                                                    if (searchQuery) {
                                                                        einstein.sendClickSearch(
                                                                            searchQuery,
                                                                            hit
                                                                        )
                                                                    } else if (category) {
                                                                        einstein.sendClickCategory(
                                                                            category,
                                                                            hit
                                                                        )
                                                                    }
                                                                }}
                                                                onFavouriteToggle={(isFavourite) => {
                                                                    const action = isFavourite
                                                                        ? addItemToWishlist
                                                                        : removeItemFromWishlist
                                                                    return action(hit)
                                                                }}
                                                                dynamicImageProps={{
                                                                    widths: [
                                                                        '50vw',
                                                                        '50vw',
                                                                        '20vw',
                                                                        '20vw',
                                                                        '25vw'
                                                                    ]
                                                                }}
                                                            />
                                                        )
                                                    }}
                                                />
                                            </SimpleGrid>
                                            {/* Footer */}
                                            <Flex
                                                justifyContent={['center', 'center', 'flex-start']}
                                                paddingTop={16}
                                            >
                                                <AlgoliaPagination onPageChange={() => window.scrollTo(0, 0)} />
                                            </Flex>
                                        </Box>
                                    </Grid>
                                </>
                            </AlgoliaNoResultsBoundary>
                            {/* Filter */}
                            <Modal
                                isOpen={isOpen}
                                onClose={onClose}
                                size="full"
                                motionPreset="slideInBottom"
                                scrollBehavior="inside"
                            >
                                <AlgoliaUiStateProvider searchClient={searchClient} indexName={productIndexName}>
                                    <ModalOverlay />
                                    <ModalContent top={0} marginTop={0}>
                                        <ModalHeader>
                                            <Text fontWeight="bold" fontSize="2xl">
                                                <FormattedMessage
                                                    defaultMessage="Filter"
                                                    id="product_list.modal.title.filter"
                                                />
                                            </Text>
                                        </ModalHeader>
                                        <ModalCloseButton />
                                        <ModalBody py={4}>
                                            <Stack spacing="6" direction="column">
                                                {filterEls}
                                            </Stack>
                                        </ModalBody>

                                        <ModalFooter
                                            // justify="space-between"
                                            display="block"
                                            width="full"
                                            borderTop="1px solid"
                                            borderColor="gray.100"
                                            paddingBottom={10}
                                        >
                                            <Stack>
                                                <Button width="full" onClick={onClose}>
                                                    {formatMessage(
                                                        {
                                                            id: 'product_list.modal.button.view_items',
                                                            defaultMessage: 'View items'
                                                        },
                                                        {
                                                            prroductCount: ''
                                                        }
                                                    )}
                                                </Button>
                                                <AlgoliaClearRefinements variant="button" />
                                            </Stack>
                                        </ModalFooter>
                                    </ModalContent>
                                </AlgoliaUiStateProvider>
                            </Modal>
                        </TabPanel>
                        <TabPanel>
                            <h1>Articles</h1>
                            <Index indexName={contentIndexName}>
                                <Hits />
                            </Index>
                        </TabPanel>
                    </TabPanels>
                </Tabs>
            </InstantSearch>
        </Box>
    )
}

ProductList.getTemplateName = () => 'product-list'

ProductList.propTypes = {
    onAddToWishlistClick: PropTypes.func,
    onRemoveWishlistClick: PropTypes.func,
    category: PropTypes.object
}

export default ProductList

const Sort = ({sortUrls, productSearchResult, basePath, ...otherProps}) => {
    const intl = useIntl()
    const history = useHistory()

    return (
        <FormControl data-testid="sf-product-list-sort" id="page_sort" width="auto" {...otherProps}>
            <Select
                value={basePath.replace(/(offset)=(\d+)/i, '$1=0')}
                onChange={({target}) => {
                    history.push(target.value)
                }}
                height={11}
                width="240px"
            >
                {sortUrls.map((href, index) => (
                    <option key={href} value={href}>
                        {intl.formatMessage(
                            {
                                id: 'product_list.select.sort_by',
                                defaultMessage: 'Sort By: {sortOption}'
                            },
                            {
                                sortOption: productSearchResult?.sortingOptions[index]?.label
                            }
                        )}
                    </option>
                ))}
            </Select>
        </FormControl>
    )
}

Sort.propTypes = {
    sortUrls: PropTypes.array,
    productSearchResult: PropTypes.object,
    basePath: PropTypes.string
}
