import React, {useState} from 'react'
import {Box, HStack, Button, Center, useMultiStyleConfig, Flex} from '@chakra-ui/react'
import {cssColorGroups} from '../../../constants'
import {productUrlBuilder, rebuildPathWithParams} from '@salesforce/retail-react-app/app/utils/url'
import Link from '@salesforce/retail-react-app/app/components/link'
import {useIntl} from 'react-intl'
import {slice} from '../../../../../config/sites'

const AlgoliaProductSwatch = (props) => {
    const {product, setSelectedColors, selectedColors} = props

    //define hook and state for url
    const intl = useIntl()

    const styles = useMultiStyleConfig('SwatchGroup', {
        variant: 'circle',
        disabled: false
    })

    const {colorVariations} = product

    const handleSetSelectedColors = (variant) => {
        let allColors = {...selectedColors}
        const newPhotoUrl = variant.image_groups[0].images[0].dis_base_link

        if (!allColors[product.masterID]) {
            allColors[product.masterID] = null
        }
        if (newPhotoUrl !== allColors[product.masterID]) {
            allColors[product.masterID] = newPhotoUrl
            setSelectedColors({...allColors})
        }
    }

    const linkBuilder = (product, variant) => {
        const path = productUrlBuilder({id: product.masterID}, intl.local)
        return rebuildPathWithParams(path, {color: variant.colorCode})
    }

    //This function resort colorVariations and put product color first
    const sortColorVariations = (colorVariations) => {
        if (!colorVariations) return []

        const productColor = colorVariations.find((color) => color.color === product.color)
        const otherColors = colorVariations.filter((color) => color.color !== product.color)
        return [productColor, ...otherColors]
    }

    const [sortedColorVariations, setSortedColorVariations] = useState(
        sortColorVariations(colorVariations)
    )

    const findSwatchImage = (variant) => {
        var image_groups = variant.image_groups

        for (var i = 0; i < image_groups.length; i++) {
            if (image_groups[i].view_type === 'swatch') {
                return image_groups[i].images[0].dis_base_link
            }
        }
        return ''
    }

    return (
        <>
            {colorVariations && colorVariations.length && (
                <HStack spacing="5px" mt={1}>
                    {sortedColorVariations.map((variant, idx) => {
                        return (
                            <Box key={idx} onMouseOver={() => handleSetSelectedColors(variant)}>
                                <Link
                                    data-testid="product-tile"
                                    {...styles.container}
                                    to={linkBuilder(product, variant)}
                                >
                                    <HStack cursor="pointer">
                                        <Button
                                            {...styles.swatch}
                                            color={'black'}
                                            variant="outline"
                                            marginRight={0}
                                            marginBottom="-1px"
                                            width="30px"
                                            height="30px"
                                            borderRadius="100%"
                                            overflow="hidden"
                                            minWidth="auto"
                                            border={'1px solid #e9e9e9'}
                                        >
                                            <Center
                                                {...styles.swatchButton}
                                                marginRight={0}
                                                width="100%"
                                                height="100%"
                                            >
                                                <Box
                                                    marginRight={0}
                                                    height="100%"
                                                    width="100%"
                                                    backgroundRepeat="no-repeat"
                                                    backgroundSize="cover"
                                                    backgroundImage={`url(${findSwatchImage(
                                                        variant
                                                    )})`}
                                                />
                                            </Center>
                                        </Button>
                                    </HStack>
                                </Link>
                            </Box>
                        )
                    })}
                </HStack>
            )}
        </>
    )
}

export default AlgoliaProductSwatch
