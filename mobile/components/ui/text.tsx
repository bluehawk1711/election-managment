import { useColor } from '@/hooks/useColor';
import { typeStyle, TypeKey } from '@/theme/typography';
import React, { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Text as RNText,
  TextProps as RNTextProps,
  TextStyle,
} from 'react-native';

type TextVariant =
  'body' | 'title' | 'subtitle' | 'caption' | 'heading' | 'link';

interface TextProps extends RNTextProps {
  variant?: TextVariant;
  lightColor?: string;
  darkColor?: string;
  children: React.ReactNode;
}

const headingVariants: TextVariant[] = ['heading', 'title', 'subtitle'];

export const Text = React.memo(
  forwardRef<RNText, TextProps>(
    (
      { variant = 'body', lightColor, darkColor, style, children, ...props },
      ref
    ) => {
      const textColor = useColor('text', {
        light: lightColor,
        dark: darkColor,
      });
      const mutedColor = useColor('textMuted');
      const { i18n } = useTranslation();
      const lang = i18n.resolvedLanguage ?? i18n.language;
      const defaultAccessibilityRole = headingVariants.includes(variant)
        ? 'header'
        : undefined;

      const getTextStyle = (): TextStyle => {
        const scaleFor = (key: TypeKey): TextStyle => typeStyle(key, lang);

        switch (variant) {
          case 'heading':
            return { ...scaleFor('headlineLg'), color: textColor };
          case 'title':
            return { ...scaleFor('headlineMd'), color: textColor };
          case 'subtitle':
            return { ...scaleFor('headlineSm'), color: textColor };
          case 'caption':
            return { ...scaleFor('bodySm'), color: mutedColor };
          case 'link':
            return {
              ...scaleFor('labelLg'),
              color: textColor,
              textDecorationLine: 'underline',
            };
          default: // 'body'
            return { ...scaleFor('bodyLg'), color: textColor };
        }
      };

      return (
        <RNText
          ref={ref}
          style={[getTextStyle(), style]}
          accessibilityRole={defaultAccessibilityRole}
          {...props}
        >
          {children}
        </RNText>
      );
    }
  )
);

Text.displayName = 'Text';
